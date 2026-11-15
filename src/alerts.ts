import type { SiteReport } from './types.js';
import type { Diff } from './report.js';

/**
 * Posts to ALERT_WEBHOOK_URL (Slack or Discord incoming webhook) only when something changed:
 * new failures, or failures that got fixed. Quiet otherwise, so alerts stay meaningful.
 */
export async function sendAlert(report: SiteReport, diff: Diff | undefined, runUrl?: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const newFails = diff ? diff.newIssues.filter((x) => x.status === 'fail') : report.results.filter((x) => x.status === 'fail');
  const fixedFails = diff?.fixed ?? [];
  if (!newFails.length && !fixedFails.length) return;

  const line = (x: { page?: string; message: string }) => `• ${x.page ? `\`${x.page}\` ` : ''}${x.message}`;
  const parts = [
    `*${report.site}*: score ${report.scores.overall}/100${diff?.scoreDelta ? ` (${diff.scoreDelta > 0 ? '+' : ''}${diff.scoreDelta})` : ''}, ${report.pages.length} pages`,
    newFails.length ? `🔴 *${newFails.length} new failure(s)*\n${newFails.slice(0, 10).map(line).join('\n')}${newFails.length > 10 ? `\n…and ${newFails.length - 10} more` : ''}` : '',
    fixedFails.length ? `🟢 *${fixedFails.length} fixed*\n${fixedFails.slice(0, 5).map(line).join('\n')}` : '',
    runUrl ? `<${runUrl}|View run>` : '',
  ].filter(Boolean);
  const text = parts.join('\n\n');

  const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(url);
  const body = isDiscord
    ? { content: text.replace(/\*([^*]+)\*/g, '**$1**').replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)').slice(0, 1990) }
    : { text };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) console.error(`Alert webhook failed: ${res.status} ${await res.text()}`);
}
