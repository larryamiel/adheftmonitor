import type { CheckResult, PageData } from '../types.js';
import { result } from '../util.js';

const ORDER = ['critical', 'serious', 'moderate', 'minor'];
const PENALTY: Record<string, number> = { critical: 15, serious: 7, moderate: 3, minor: 1 };

/** 0–100 per page: each violated rule costs points by impact (rule counted once, not per element). */
export function a11yScore(p: PageData): number {
  return Math.max(0, 100 - p.axe.reduce((s, v) => s + (PENALTY[v.impact] ?? 1), 0));
}

/** axe-core WCAG 2.2 AA scan. critical → fail, serious → warn, moderate/minor → info. */
export function a11yPageCheck(p: PageData): CheckResult[] {
  if (p.axeError) return [result('a11y', 'axe', 'info', `Accessibility scan failed: ${p.axeError}`, p.path)];
  const v = [...p.axe].sort((a, b) => ORDER.indexOf(a.impact) - ORDER.indexOf(b.impact));
  if (!v.length) return [result('a11y', 'axe', 'pass', 'No WCAG 2.2 AA violations found', p.path)];
  const has = (i: string) => v.some((x) => x.impact === i);
  const status = has('critical') ? 'fail' : has('serious') ? 'warn' : 'info';
  const counts = ORDER.map((i) => [i, v.filter((x) => x.impact === i).length] as const).filter(([, n]) => n);
  return [result('a11y', 'axe', status,
    `Accessibility ${a11yScore(p)}/100: ${counts.map(([i, n]) => `${n} ${i}`).join(', ')}`, p.path,
    v.map((x) => `[${x.impact}] ${x.id}: ${x.help} (${x.nodes}×, e.g. ${x.sample})`))];
}
