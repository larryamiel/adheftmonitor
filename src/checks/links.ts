import pLimit from 'p-limit';
import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { fetchWithTimeout, result, truncate } from '../util.js';

const MAX_LINKS = 5000;
/**
 * Never probed: social profiles and share/intent links. These sites block automated requests (403/429/999)
 * on every run, so checking them only produces noise.
 */
const SKIP_PROBE = /^https?:\/\/([\w-]+\.)?(facebook\.com|fb\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|pinterest\.com|threads\.net|yelp\.com|nextdoor\.com)\b|\/(sharer|share|intent)(\/|\.php|\?|$)|[?&](share|url)=http/i;

/** Statuses that usually mean "bot blocked", not "broken". */
const BOT_BLOCKED = new Set([401, 403, 405, 429, 999]);

async function probe(url: string): Promise<number | string> {
  try {
    let res = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow', timeoutMs: 12_000 });
    if (res.status === 405 || res.status === 403 || res.status === 501 || res.status === 404) {
      // Many servers mishandle HEAD; confirm with GET.
      res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', timeoutMs: 15_000 });
      await res.body?.cancel();
    }
    return res.status;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return err.cause?.code ?? err.name ?? 'error';
  }
}

export async function linkChecks(site: SiteConfig, pages: PageData[]): Promise<CheckResult[]> {
  const base = new URL(site.baseUrl);
  const ignore = (site.links?.ignore ?? []).map((r) => new RegExp(r, 'i'));
  const checkExternal = site.links?.external ?? true;
  const known = new Map(pages.filter((p) => !p.error).map((p) => [stripHash(p.url), p.status]));

  const sources = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const l of p.links) {
      if (!/^https?:/i.test(l)) continue;
      const u = stripHash(l);
      if (ignore.some((r) => r.test(u)) || SKIP_PROBE.test(u)) continue;
      const internal = new URL(u).hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '');
      if (!internal && !checkExternal) continue;
      if (!sources.has(u)) sources.set(u, new Set());
      sources.get(u)!.add(p.path);
    }
  }

  const urls = [...sources.keys()].slice(0, MAX_LINKS);
  const limit = pLimit(10);
  const statuses = await Promise.all(urls.map((u) => limit(async () => [u, known.get(u) ?? (await probe(u))] as const)));

  const broken: string[] = [];
  const suspicious: string[] = [];
  for (const [u, s] of statuses) {
    const from = [...sources.get(u)!].slice(0, 3).join(', ');
    const line = `[${s}] ${truncate(u)}  ← ${from}`;
    if (typeof s === 'number' && s < 400) continue;
    if (typeof s === 'number' && BOT_BLOCKED.has(s)) suspicious.push(line);
    else if (typeof s === 'number' && s >= 500) suspicious.push(line);
    else broken.push(line); // 404/410/DNS failure/connection refused
  }

  const out: CheckResult[] = [];
  out.push(broken.length
    ? result('links', 'broken', 'fail', `${broken.length} broken link(s) of ${urls.length} checked`, undefined, broken)
    : result('links', 'broken', 'pass', `${urls.length} unique link(s) checked, none broken`));
  if (suspicious.length) out.push(result('links', 'unverified', 'warn', `${suspicious.length} link(s) blocked bots or errored (verify manually)`, undefined, suspicious));
  if (sources.size > MAX_LINKS) out.push(result('links', 'cap', 'info', `Only first ${MAX_LINKS} of ${sources.size} links checked`));
  return out;
}

const stripHash = (u: string) => u.split('#')[0];
