import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import type { Category, CheckResult, SiteReport, Status } from './types.js';

const ICON: Record<Status, string> = { pass: pc.green('✔'), warn: pc.yellow('▲'), fail: pc.red('✖'), info: pc.cyan('ℹ') };
const RANK: Record<Status, number> = { pass: 0, info: 0, warn: 1, fail: 2 };
const CATS: Category[] = ['health', 'seo', 'tracking', 'content', 'errors', 'links', 'security', 'responsive', 'visual', 'a11y', 'performance'];

const colorScore = (n: number) => (n < 0 ? pc.dim('  –') : (n >= 90 ? pc.green : n >= 70 ? pc.yellow : pc.red)(String(n).padStart(3)));

export function printReport(r: SiteReport, verbose = false) {
  console.log('\n' + pc.bold(`━━ ${r.site} ━━ ${r.baseUrl}`) + pc.dim(`  ${r.pages.length} page(s), ${(r.durationMs / 1000).toFixed(0)}s`));
  for (const cat of CATS) {
    const rs = r.results.filter((x) => x.category === cat);
    if (!rs.length) continue;
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    rs.forEach((x) => counts[x.status]++);
    console.log(`\n${colorScore(r.scores[cat])}  ${pc.bold(cat.toUpperCase())}  ` +
      pc.dim(`${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail`));
    const shown = rs
      .filter((x) => verbose || x.status === 'fail' || x.status === 'warn' ||
        (x.status === 'info' && (!x.page || x.category === 'visual' || x.category === 'performance')))
      .sort((a, b) => RANK[b.status] - RANK[a.status]);
    // On full-site crawls the same issue repeats on many pages: collapse identical messages.
    const groups = new Map<string, CheckResult[]>();
    for (const x of shown) {
      const k = `${x.id}|${x.status}|${x.message}|${x.details?.join('\n') ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), x]);
    }
    for (const g of groups.values()) {
      const x = g[0];
      const where = g.length > 1
        ? pc.dim(`[${g.length} pages] `)
        : x.page ? pc.dim(x.page.padEnd(28).slice(0, 28)) + ' ' : '';
      console.log(`     ${ICON[x.status]} ${where}${x.message}`);
      const details = [...(g.length > 1 ? [`pages: ${g.slice(0, 6).map((y) => y.page).join(', ')}${g.length > 6 ? ', …' : ''}`] : []), ...(x.details ?? [])];
      for (const d of details.slice(0, verbose ? 50 : 8)) console.log(pc.dim(`         · ${d}`));
      if (!verbose && details.length > 8) console.log(pc.dim(`         · …${details.length - 8} more (use --verbose)`));
    }
  }
  if (r.viewportScores && Object.keys(r.viewportScores).length) {
    console.log(`\n${pc.bold('SCREEN WIDTHS')}  ` +
      Object.entries(r.viewportScores).map(([w, s]) => `${pc.dim(w + 'px')} ${colorScore(s).trim()}`).join('   '));
  }
  console.log(`\n${pc.bold('OVERALL')} ${colorScore(r.scores.overall)}/100\n`);
}

function keyed(results: CheckResult[]) {
  const map = new Map<string, CheckResult>();
  const n = new Map<string, number>();
  for (const x of results) {
    const base = `${x.id}|${x.page ?? ''}`;
    const i = n.get(base) ?? 0;
    n.set(base, i + 1);
    map.set(`${base}|${i}`, x);
  }
  return map;
}

export interface Diff { newIssues: CheckResult[]; fixed: CheckResult[]; scoreDelta: number }

export function diffReports(prev: SiteReport, cur: SiteReport): Diff {
  const a = keyed(prev.results);
  const b = keyed(cur.results);
  const newIssues: CheckResult[] = [];
  const fixed: CheckResult[] = [];
  for (const [k, x] of b) {
    const before = a.get(k);
    if (RANK[x.status] > (before ? RANK[before.status] : 0)) newIssues.push(x);
  }
  const checkedNow = new Set(cur.pages);
  const catsNow = new Set(cur.results.map((r) => r.category));
  for (const [k, x] of a) {
    if (RANK[x.status] === 0) continue;
    const after = b.get(k);
    if (after) {
      if (RANK[after.status] < RANK[x.status]) fixed.push(after);
    } else if ((x.page ? checkedNow.has(x.page) : true) && catsNow.has(x.category)) {
      // Previous runs stored in the DB keep only problems, so "absent now" on a re-checked page = resolved.
      fixed.push({ ...x, status: 'pass', details: undefined });
    }
  }
  return { newIssues, fixed, scoreDelta: cur.scores.overall - prev.scores.overall };
}

export function printDiff(d: Diff, prev: SiteReport) {
  const when = new Date(prev.startedAt).toLocaleString();
  console.log(pc.bold(`Changes since last run (${when}):`) + ' ' +
    (d.scoreDelta === 0 ? pc.dim('score unchanged') : d.scoreDelta > 0 ? pc.green(`score +${d.scoreDelta}`) : pc.red(`score ${d.scoreDelta}`)));
  if (!d.newIssues.length && !d.fixed.length) console.log(pc.dim('  no new issues, nothing fixed'));
  for (const x of d.newIssues) console.log(`  ${pc.red('NEW')}   ${ICON[x.status]} ${x.page ?? ''} ${x.message}`);
  for (const x of d.fixed) console.log(`  ${pc.green('FIXED')} ${ICON[x.status]} ${x.page ?? ''} ${x.message}`);
  console.log();
}

/** Saves the run; returns the previous full run. Partial runs never replace latest.json (the diff baseline). */
export async function saveReport(r: SiteReport, partial = false, dir = 'reports'): Promise<SiteReport | undefined> {
  const siteDir = join(dir, r.site);
  await mkdir(siteDir, { recursive: true });
  const latest = join(siteDir, 'latest.json');
  let prev: SiteReport | undefined;
  try { prev = JSON.parse(await readFile(latest, 'utf8')); } catch { /* first run */ }
  const json = JSON.stringify(r, null, 2);
  await writeFile(join(siteDir, `${r.startedAt.replace(/[:.]/g, '-')}.json`), json);
  if (!partial) await writeFile(latest, json);
  return prev;
}
