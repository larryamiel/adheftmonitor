import type { Browser } from 'playwright';
import type { Category, CheckResult, PageData, SiteConfig, SiteReport } from './types.js';
import { loadPage } from './browser.js';
import { healthPageChecks, healthSiteChecks } from './checks/health.js';
import { robotsAndSitemap, seoCrossPageChecks, seoPageChecks } from './checks/seo.js';
import { trackingChecks } from './checks/tracking.js';
import { contentChecks } from './checks/content.js';
import { errorChecks } from './checks/errors.js';
import { securityChecks } from './checks/security.js';
import { linkChecks } from './checks/links.js';
import { responsivePageCheck, viewportAverages } from './checks/responsive.js';
import { a11yPageCheck, a11yScore } from './checks/a11y.js';
import { pageSpeedChecks, weightPageCheck } from './checks/performance.js';
import { defaultStore, visualChecks, type ImageStore } from './visual.js';

export interface RunOptions {
  /** Only check these paths; disables crawling. */
  pages?: string[];
  maxPages?: number;
  links?: boolean;
  concurrency?: number;
  /** Layout audit at 8 screen widths on every page. Default true. */
  responsive?: boolean;
  /** axe-core accessibility scan on every page. Default true. */
  a11y?: boolean;
  /** Screenshot comparison on key pages. Default true. */
  visual?: boolean;
  /** Overwrite visual baselines with this run's screenshots. */
  approve?: boolean;
  /** PageSpeed Insights on key pages. Default true. */
  psi?: boolean;
  store?: ImageStore;
  onProgress?: (msg: string) => void;
}

/**
 * Never crawled: CMS system pages and archive listings that aren't real content
 * (WordPress date archives, login/admin, feeds, pagination, author archives).
 */
const DEFAULT_EXCLUDE = /^\/(wp-login\.php|wp-admin|wp-json|xmlrpc\.php|cgi-bin)|\/feed\/?$|^\/\d{4}\/(\d{2}\/)?(\d{2}\/)?$|\/page\/\d+\/?$|^\/author\//;

/** "/contact-us/" and "/contact-us" are the same page for key-page matching. */
const samePath = (p: string) => p.replace(/\/+$/, '') || '/';

/** Safety limit so a crawl trap (calendar, faceted search) can't run forever. */
const HARD_CAP = 5000;

const SKIP_EXT =/\.(pdf|jpe?g|png|gif|webp|avif|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|mov|xml|txt|ics)$/i;

function normalize(site: SiteConfig, raw: string): string | null {
  try {
    const base = new URL(site.baseUrl);
    const u = new URL(raw, site.baseUrl);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return null;
    u.protocol = base.protocol;
    u.host = base.host;
    u.hash = '';
    if (!site.crawl?.includeQuery) u.search = '';
    if (SKIP_EXT.test(u.pathname)) return null;
    const pathAndQuery = u.pathname + u.search;
    if (DEFAULT_EXCLUDE.test(u.pathname)) return null;
    if ((site.crawl?.exclude ?? []).some((r) => new RegExp(r).test(pathAndQuery))) return null;
    return u.href;
  } catch {
    return null;
  }
}

export async function runSite(browser: Browser, site: SiteConfig, opts: RunOptions = {}): Promise<SiteReport> {
  const started = Date.now();
  const log = opts.onProgress ?? (() => {});
  const results: CheckResult[] = [];
  const manual = !!opts.pages?.length;
  const maxPages = manual ? opts.pages!.length : Math.min(opts.maxPages || site.crawl?.maxPages || HARD_CAP, HARD_CAP);
  const followLinks = !manual && (site.crawl?.followLinks ?? true);

  log('site-level checks (SSL, domain, redirects, robots, sitemap)…');
  const [health, robots] = await Promise.all([healthSiteChecks(site), robotsAndSitemap(site)]);
  results.push(...health, ...robots.results);

  // Build the page queue: explicit pages first, then sitemap, then discovered links.
  const seen = new Set<string>();
  const queue: string[] = [];
  let capped = false;
  const enqueue = (raw: string) => {
    const u = normalize(site, raw);
    if (!u || seen.has(u)) return;
    if (seen.size >= maxPages) { capped = true; return; }
    seen.add(u);
    queue.push(u);
  };
  for (const p of opts.pages ?? site.pages ?? ['/']) {
    if (!normalize(site, p)) throw new Error(`Page "${p}" is not a crawlable path on ${site.baseUrl} (excluded or invalid)`);
    enqueue(p);
  }
  if (!manual && (site.crawl?.sitemap ?? true)) robots.sitemapUrls.forEach(enqueue);
  const sitemapPaths = new Set(robots.sitemapUrls.map((u) => { try { return samePath(new URL(u).pathname); } catch { return ''; } }));

  // Key pages get screenshots + PageSpeed. For a manual --pages check, the pages you changed are the key pages.
  const keyPaths = new Set(
    (manual ? opts.pages! : site.keyPages ?? ['/', ...(site.pages ?? [])])
      .map((p) => normalize(site, p)).filter((u): u is string => !!u).map((u) => samePath(new URL(u).pathname)),
  );
  const store = opts.store ?? defaultStore();
  const psi = (opts.psi ?? !!process.env.PSI_API_KEY) ? pageSpeedChecks(site, [...keyPaths]) : Promise.resolve([]);

  const pages: PageData[] = [];
  const skipped: string[] = [];
  let active = 0;
  let done = 0;
  const concurrency = opts.concurrency ?? site.crawl?.concurrency ?? 4;
  await new Promise<void>((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) return resolve();
      while (active < concurrency && queue.length) {
        const url = queue.shift()!;
        active++;
        const isKey = keyPaths.has(samePath(new URL(url).pathname));
        loadPage(browser, site, url, {
          responsive: opts.responsive ?? true,
          a11y: opts.a11y ?? true,
          screenshots: isKey && (opts.visual ?? true),
          mask: site.visual?.mask,
        })
          .then(async (pd) => {
            done++;
            log(`page ${done}/${seen.size}: ${pd.path}`);
            if (pd.skipped) { skipped.push(`${pd.path} (${pd.skipped})`); return; }
            if (followLinks) pd.links.forEach(enqueue);
            // Check the page now, then release the heavy fields so full-site crawls stay light on memory.
            results.push(...healthPageChecks(pd));
            if (!pd.error) {
              results.push(
                ...seoPageChecks(site, pd, pd.path === '/' || keyPaths.has(samePath(pd.path)) || sitemapPaths.has(samePath(pd.path)) || !robots.sitemapUrls.length),
                ...contentChecks(site, pd), ...errorChecks(site, pd),
                ...responsivePageCheck(pd), ...a11yPageCheck(pd), ...weightPageCheck(pd),
              );
              if (pd.screenshots.length) results.push(...(await visualChecks(site, pd, store, !!opts.approve)));
            }
            pd.html = '';
            pd.text = '';
            pd.screenshots = [];
            pages.push(pd);
          })
          .catch((e) => { results.push({ id: 'health.load', category: 'health', status: 'fail', message: `Crashed loading ${url}: ${(e as Error).message}` }); })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
  pages.sort((a, b) => a.path.localeCompare(b.path));
  results.push({ id: 'health.crawl', category: 'health', status: capped ? 'warn' : 'info',
    message: capped ? `Crawl stopped at the ${maxPages}-page cap; some pages were not checked` : `Crawled ${pages.length} page(s)`,
    details: skipped.length ? [`Skipped non-HTML: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ' …' : ''}`] : undefined });

  const ok = pages.filter((p) => !p.error);
  if (!ok.length) results.push({ id: 'health.no-pages', category: 'health', status: 'fail', message: 'No pages could be loaded' });
  results.push(...seoCrossPageChecks(ok), ...trackingChecks(site, ok));
  const home = ok.find((p) => p.path === '/') ?? ok[0];
  if (home) results.push(...securityChecks(home));

  if (opts.links ?? true) {
    log('checking links…');
    results.push(...(await linkChecks(site, pages)));
  }
  log('waiting for PageSpeed Insights…');
  results.push(...(await psi));

  const viewportScores = viewportAverages(ok);
  if (Object.keys(viewportScores).length) {
    results.push({ id: 'responsive.summary', category: 'responsive', status: 'info',
      message: `Average layout score by screen width (${ok.length} pages)`,
      details: [Object.entries(viewportScores).map(([w, s]) => `${w}px: ${s}`).join('  ·  ')] });
  }
  const scores = score(results);
  // Responsive and a11y categories use real averaged scores instead of pass/warn counting:
  // one shared footer issue shouldn't zero out the whole category.
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const vs = Object.values(viewportScores);
  if (vs.length) scores.responsive = avg(vs);
  const scanned = ok.filter((p) => p.layout.length || p.axe.length || !p.axeError);
  if (opts.a11y ?? true) {
    const a = scanned.filter((p) => !p.axeError).map(a11yScore);
    if (a.length) scores.a11y = avg(a);
  }
  scores.overall = overallOf(scores);

  return {
    site: site.name,
    baseUrl: site.baseUrl,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    pages: pages.map((p) => p.path),
    results,
    scores,
    viewportScores,
  };
}

export function score(results: CheckResult[]): SiteReport['scores'] {
  const cats = CATEGORIES;
  const scores = {} as SiteReport['scores'];
  const used: number[] = [];
  for (const c of cats) {
    const r = results.filter((x) => x.category === c && x.status !== 'info');
    if (!r.length) { scores[c] = -1; continue; }
    const pts = r.reduce((s, x) => s + (x.status === 'pass' ? 1 : x.status === 'warn' ? 0.5 : 0), 0);
    scores[c] = Math.round((pts / r.length) * 100);
    used.push(scores[c]);
  }
  scores.overall = used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : 0;
  return scores;
}

export const CATEGORIES: Category[] = [
  'health', 'seo', 'tracking', 'content', 'errors', 'links', 'security', 'responsive', 'visual', 'a11y', 'performance',
];

function overallOf(scores: SiteReport['scores']): number {
  const used = CATEGORIES.map((c) => scores[c]).filter((n) => n >= 0);
  return used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : 0;
}
