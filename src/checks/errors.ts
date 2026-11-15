import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { result, truncate } from '../util.js';

export function errorChecks(site: SiteConfig, p: PageData): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (id: string, s: CheckResult['status'], msg: string, d?: string[]) => out.push(result('errors', id, s, msg, p.path, d));
  const host = new URL(site.baseUrl).hostname.replace(/^www\./, '');
  const isOwn = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').endsWith(host); } catch { return false; } };

  if (p.pageErrors.length) add('js-exceptions', 'fail', `${p.pageErrors.length} uncaught JS exception(s)`, [...new Set(p.pageErrors)]);
  else add('js-exceptions', 'pass', 'No uncaught JS exceptions');

  const consoleErrs = [...new Set(p.consoleErrors)].filter((e) => !/Failed to load resource/.test(e)); // covered below
  if (consoleErrs.length) add('console', 'warn', `${consoleErrs.length} console error(s)`, consoleErrs.slice(0, 15));
  else add('console', 'pass', 'No console errors');

  const fmt = (f: PageData['failedRequests'][number]) => `[${f.status}] ${f.resourceType} ${truncate(f.url)}`;
  const own = p.failedRequests.filter((f) => isOwn(f.url));
  const third = p.failedRequests.filter((f) => !isOwn(f.url));
  if (own.length) add('failed-requests', 'fail', `${own.length} failed request(s) to your own domain`, own.map(fmt));
  else add('failed-requests', 'pass', 'No failed first-party requests');
  if (third.length) add('failed-3p-requests', 'warn', `${third.length} failed third-party request(s)`, third.map(fmt).slice(0, 15));

  if (p.brokenImages.length) add('broken-images', 'fail', `${p.brokenImages.length} broken image(s)`, p.brokenImages.map((u) => truncate(u)));
  else add('broken-images', 'pass', 'No broken images');

  if (p.url.startsWith('https:')) {
    const mixed = [...new Set(p.requests.filter((u) => u.startsWith('http:')))];
    if (mixed.length) add('mixed-content', 'fail', `${mixed.length} insecure http:// resource(s) on https page`, mixed.map((u) => truncate(u)));
    else add('mixed-content', 'pass', 'No mixed content');
  }
  return out;
}
