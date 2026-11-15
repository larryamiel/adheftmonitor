import './env.js';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { loadConfig } from './config.js';
import { launchBrowser } from './browser.js';
import { runSite } from './runner.js';
import { diffReports, printDiff, printReport, saveReport, type Diff } from './report.js';
import { dbConfigured, failRun, finishRun, loadSitesFromDb, previousReport, startRun, type RunKind } from './db.js';
import { sendAlert } from './alerts.js';
import type { SiteConfig, SiteReport } from './types.js';

/** Public CI logs: set QA_PRIVATE_LOGS=1 to print only anonymous one-line summaries. */
const PRIVATE = process.env.QA_PRIVATE_LOGS === '1';

const HELP = `
Adheft Monitor: site QA checklist

Usage: npm run qa -- [options]

  --site <name|id>     Only this site (repeatable). Default: all enabled sites
  --pages /,/about     Manual check: only these paths, no crawling (fast, use after a change)
  --quick              Scheduled quick check: key pages only, no link checking
  --max-pages <n>      Cap pages per site (default: all pages)
  --no-links           Skip link checking
  --no-responsive      Skip the layout audit at 8 screen widths
  --no-a11y            Skip the accessibility scan
  --no-visual          Skip screenshot comparison
  --no-psi             Skip PageSpeed Insights (skipped automatically when PSI_API_KEY is not set)
  --approve            Accept current screenshots as the new visual baseline (after an intended change)
  --verbose            Show passing checks and all details
  --headed             Show the browser window
  --source db|file     Where sites come from. Default: db if SUPABASE_* env vars are set, else file
  --config <file>      Config file for --source file (default sites.config.ts)
  --trigger <name>     Recorded on the run: cli | schedule | manual | deploy (default cli)
  --no-save            Don't write the run to the database
`;

async function main() {
  const { values } = parseArgs({
    options: {
      site: { type: 'string', multiple: true },
      pages: { type: 'string' },
      'max-pages': { type: 'string' },
      'no-links': { type: 'boolean', default: false },
      'no-responsive': { type: 'boolean', default: false },
      'no-a11y': { type: 'boolean', default: false },
      'no-visual': { type: 'boolean', default: false },
      'no-psi': { type: 'boolean', default: false },
      approve: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      source: { type: 'string' },
      config: { type: 'string', default: 'sites.config.ts' },
      trigger: { type: 'string', default: 'cli' },
      'no-save': { type: 'boolean', default: false },
      quick: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) return console.log(HELP);

  const source = values.source ?? (dbConfigured() ? 'db' : 'file');
  const all: (SiteConfig & { id?: string })[] = source === 'db' ? await loadSitesFromDb(!!values.site) : await loadConfig(values.config);
  // --site accepts names or database IDs (CI uses IDs so public logs don't reveal which sites are monitored).
  const sites = values.site ? all.filter((s) => values.site!.includes(s.name) || (s.id && values.site!.includes(s.id))) : all;
  if (!sites.length) throw new Error(PRIVATE ? 'No site matched.' : `No site matched. Known (${source}): ${all.map((s) => s.name).join(', ') || 'none'}`);
  const useDb = source === 'db' && !values['no-save'];
  const runUrl = process.env.GITHUB_RUN_URL;
  const kind: RunKind = values.pages ? 'manual' : values.quick ? 'quick' : 'full';

  const browser = await launchBrowser(values.headed);
  let failed = false;
  try {
    for (const site of sites) {
      const label = PRIVATE ? `site ${site.id?.slice(0, 8) ?? '?'}` : site.name;
      // Quick = key pages only (what the daily full crawl covers in depth), no link checking.
      const pages = values.pages?.split(',').map((s) => s.trim()).filter(Boolean)
        ?? (kind === 'quick' ? site.keyPages ?? ['/', ...(site.pages ?? [])] : undefined);
      const runId = useDb && site.id ? await startRun(site.id, values.trigger!, kind) : undefined;
      let report: SiteReport;
      try {
        report = await runSite(browser, site, {
          pages,
          maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
          links: !values['no-links'] && kind !== 'quick',
          responsive: !values['no-responsive'],
          a11y: !values['no-a11y'],
          visual: !values['no-visual'],
          psi: values['no-psi'] ? false : undefined, // default: on only when PSI_API_KEY is set
          approve: values.approve,
          onProgress: (m) => !PRIVATE && process.stdout.isTTY && process.stdout.write(`\r\x1b[K${pc.dim(`[${site.name}] ${m}`)}`),
        });
      } catch (e) {
        if (runId) await failRun(runId, (e as Error).message);
        throw new Error(`${label}: ${scrub((e as Error).message, site.baseUrl)}`);
      }
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
      if (!PRIVATE) printReport(report, values.verbose);

      // Diff against the previous run: from the DB when available, else local reports/.
      const localPrev = await saveReport(report, kind !== 'full');
      const prev = runId ? await previousReport(site.id!, runId, kind) : localPrev;
      let diff: Diff | undefined;
      if (prev) {
        diff = diffReports(prev, report);
        if (!PRIVATE) printDiff(diff, prev);
      }
      if (runId) await finishRun(runId, report, diff);
      // Manual (--pages) runs don't alert: they're for checking your own change.
      if (kind !== 'manual') await sendAlert(report, diff, runUrl);
      const fails = report.results.filter((r) => r.status === 'fail').length;
      if (fails) failed = true;
      if (PRIVATE) {
        // Public CI logs: no names, URLs or findings. Details live in the dashboard.
        const warns = report.results.filter((r) => r.status === 'warn').length;
        console.log(`${label} [${kind}]: score ${report.scores.overall}/100, ${report.pages.length} pages, ` +
          `${fails} fail, ${warns} warn, ${diff?.newIssues.length ?? 0} new, ${diff?.fixed.length ?? 0} fixed, ` +
          `${Math.round(report.durationMs / 1000)}s`);
      }
    }
  } finally {
    await browser.close();
  }
  if (PRIVATE) console.log(failed ? 'QA finished: failures found (see dashboard / alerts)' : 'QA finished: all checks passed');
  else console.log(failed ? pc.red(pc.bold('✖ QA FAILED')) : pc.green(pc.bold('✔ QA PASSED')));
  // In CI, findings are reported via dashboard/alerts; only crashes fail the job (avoids GitHub failure emails).
  process.exitCode = failed && !PRIVATE ? 1 : 0;
}

/** Remove site URLs/hostnames from a message destined for public logs. */
function scrub(msg: string, baseUrl: string): string {
  if (!PRIVATE) return msg;
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');
  return msg.replace(/https?:\/\/\S+/g, '<url>').split(host).join('<site>');
}

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exitCode = 2;
});
