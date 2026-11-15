import './env.js';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { loadConfig } from './config.js';
import { launchBrowser } from './browser.js';
import { runSite } from './runner.js';
import { diffReports, printDiff, printReport, saveReport, type Diff } from './report.js';
import { dbConfigured, failRun, finishRun, loadSitesFromDb, previousReport, startRun } from './db.js';
import { sendAlert } from './alerts.js';
import type { SiteConfig, SiteReport } from './types.js';

const HELP = `
Adheft Monitor: site QA checklist

Usage: npm run qa -- [options]

  --site <name>        Only this site (repeatable). Default: all enabled sites
  --pages /,/about     Manual check: only these paths, no crawling (fast, use after a change)
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
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) return console.log(HELP);

  const source = values.source ?? (dbConfigured() ? 'db' : 'file');
  const all: (SiteConfig & { id?: string })[] = source === 'db' ? await loadSitesFromDb() : await loadConfig(values.config);
  const sites = values.site ? all.filter((s) => values.site!.includes(s.name)) : all;
  if (!sites.length) throw new Error(`No site matched. Known (${source}): ${all.map((s) => s.name).join(', ') || 'none'}`);
  const useDb = source === 'db' && !values['no-save'];
  const runUrl = process.env.GITHUB_RUN_URL;

  const browser = await launchBrowser(values.headed);
  let failed = false;
  try {
    for (const site of sites) {
      const runId = useDb && site.id ? await startRun(site.id, values.trigger!, !!values.pages) : undefined;
      let report: SiteReport;
      try {
        report = await runSite(browser, site, {
          pages: values.pages?.split(',').map((s) => s.trim()).filter(Boolean),
          maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
          links: !values['no-links'],
          responsive: !values['no-responsive'],
          a11y: !values['no-a11y'],
          visual: !values['no-visual'],
          psi: values['no-psi'] ? false : undefined, // default: on only when PSI_API_KEY is set
          approve: values.approve,
          onProgress: (m) => process.stdout.isTTY && process.stdout.write(`\r\x1b[K${pc.dim(`[${site.name}] ${m}`)}`),
        });
      } catch (e) {
        if (runId) await failRun(runId, (e as Error).message);
        throw e;
      }
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
      printReport(report, values.verbose);

      // Diff against the previous run: from the DB when available, else local reports/.
      const localPrev = await saveReport(report, !!values.pages);
      const prev = runId ? await previousReport(site.id!, runId) : localPrev;
      let diff: Diff | undefined;
      // For --pages runs this compares just those pages against the last full run.
      if (prev) { diff = diffReports(prev, report); printDiff(diff, prev); }
      if (runId) await finishRun(runId, report, diff);
      // Partial (--pages) runs don't alert: they're for checking your own change.
      if (!values.pages) await sendAlert(report, diff, runUrl);
      if (report.results.some((r) => r.status === 'fail')) failed = true;
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? pc.red(pc.bold('✖ QA FAILED')) : pc.green(pc.bold('✔ QA PASSED')));
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exitCode = 2;
});
