import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import type { PageData, SiteConfig } from './types.js';
import { MOBILE_MAX, SCREENSHOT_WIDTHS, VIEWPORTS, auditLayoutInPage, scoreLayout } from './checks/responsive.js';

export interface LoadOptions {
  /** Layout audit at every screen width. */
  responsive: boolean;
  /** axe-core accessibility scan. */
  a11y: boolean;
  /** Full-page screenshots at every width (key pages only). */
  screenshots: boolean;
  /** CSS selectors masked in screenshots. */
  mask?: string[];
  /** Widths to screenshot. Default SCREENSHOT_WIDTHS. */
  screenshotWidths?: number[];
}

/**
 * Analytics hit endpoints. We let the tag *libraries* load (that's what we verify), but the final
 * tracking beacons are answered locally with 204 so monitoring runs never pollute GA4 / Meta data.
 */
const BEACON_PATTERNS = [
  /google-analytics\.com\/(g\/)?collect/,
  /analytics\.google\.com\/g\/collect/,
  /googletagmanager\.com\/[a-z/]*collect/,
  /stats\.g\.doubleclick\.net/,
  /google\.com\/(ccm|pagead)\/.*collect/,
  /facebook\.com\/tr\b/,
];

export const isBeacon = (url: string) => BEACON_PATTERNS.some((re) => re.test(url));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expectedTagPatterns(site: SiteConfig, path: string): RegExp[] {
  const t = site.tracking;
  if (!t || t.skipPages?.includes(path)) return [];
  return [
    ...(t.gtm ?? []).map((id) => new RegExp(`gtm\\.js\\?.*id=${esc(id)}`, 'i')),
    ...(t.ga4 ?? []).map((id) => new RegExp(`(collect\\?.*tid=|gtag/js\\?.*id=)${esc(id)}`, 'i')),
    ...(t.metaPixel ?? []).map((id) => new RegExp(`(signals/config/${esc(id)}|facebook\\.com/tr.*id=${esc(id)})`)),
    ...(t.callrail ? [/cdn\.callrail\.com\/companies\//] : []),
    ...(t.custom ?? []).map((c) => new RegExp(c.pattern, 'i')),
  ];
}

export async function launchBrowser(headed = false): Promise<Browser> {
  return chromium.launch({ headless: !headed });
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ua =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${browser.version()} Safari/537.36 AdheftMonitor/1.0`;
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1366, height: 900 }, ignoreHTTPSErrors: false });
  // tsx/esbuild wraps named functions in __name(); functions we send to the page need it defined there.
  await ctx.addInitScript({ content: 'window.__name = window.__name || ((f) => f);' });
  return ctx;
}

export async function loadPage(browser: Browser, site: SiteConfig, url: string, opts: LoadOptions): Promise<PageData> {
  // Fresh context per page: no shared cache/cookies, so every page is a first-time visitor and every
  // tag request is observable (memory-cache hits are not always reported as network requests).
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const path = new URL(url).pathname + new URL(url).search;
  const data: PageData = {
    url, path, status: 0, headers: {}, html: '', text: '', ttfbMs: 0, loadMs: 0,
    requests: [], beacons: [], consoleErrors: [], pageErrors: [], failedRequests: [],
    brokenImages: [], links: [], hasDataLayer: false, gtmInHtml: [], title: '', description: '',
    layout: [], axe: [], screenshots: [], weight: { total: 0, byType: {}, largeImages: [] },
    rateLimited: [], noindex: false, host: '', canonical: '',
  };
  let measuringWeight = true;

  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (isBeacon(u)) {
      // Some tags (Meta Pixel, batched GA4) POST their params; keep the body so IDs/events can be matched.
      const body = route.request().postData();
      data.beacons.push(body ? `${u}&${body.slice(0, 4000)}` : u);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.continue();
  });

  page.on('request', (r) => data.requests.push(r.url()));
  page.on('console', (m) => {
    if (m.type() === 'error') data.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => data.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText ?? 'failed';
    if (err.includes('ERR_ABORTED')) return; // navigations / cancelled media, not real breakage
    // ORB = Chromium silently blocking an opaque cross-origin response (e.g. Meta Pixel's own error logger).
    // Not visible to visitors and not fixable by the site owner.
    if (err.includes('ERR_BLOCKED_BY_ORB')) return;
    data.failedRequests.push({ url: r.url(), status: err, resourceType: r.resourceType() });
  });
  page.on('response', (r) => {
    const req = r.request();
    // The main document's own status is reported by the health checks, so skip it here.
    const isMainDoc = req.isNavigationRequest() && req.frame() === page.mainFrame();
    // 429/503 + Retry-After = the host throttling the monitor (WP Engine/Cloudflare do this to fast crawlers),
    // not a broken resource. Tracked separately and excluded from error checks.
    if ((r.status() === 429 || (r.status() === 503 && r.headers()['retry-after'])) && !isMainDoc) {
      data.rateLimited.push(r.url());
      return;
    }
    if (r.status() >= 400 && !isMainDoc) {
      data.failedRequests.push({ url: r.url(), status: r.status(), resourceType: r.request().resourceType() });
    }
    if (measuringWeight && !isBeacon(r.url())) {
      const bytes = Number(r.headers()['content-length'] ?? 0);
      if (bytes > 0) {
        const type = req.resourceType();
        data.weight.total += bytes;
        data.weight.byType[type] = (data.weight.byType[type] ?? 0) + bytes;
        if (type === 'image' && bytes > 300 * 1024) data.weight.largeImages.push({ url: r.url(), bytes });
      }
    }
  });

  const t0 = Date.now();
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    data.loadMs = Date.now() - t0;
    data.status = res?.status() ?? 0;
    data.headers = (await res?.allHeaders()) ?? {};
    const ctype = data.headers['content-type'] ?? '';
    if (ctype && !/html/i.test(ctype)) {
      data.skipped = ctype.split(';')[0];
      return data;
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    if (site.consentSelector) {
      const btn = page.locator(site.consentSelector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(2000); // let tag managers fire late tags
    // If an expected tag hasn't shown up yet, give it extra time instead of reporting a false "missing".
    const expected = expectedTagPatterns(site, path);
    for (let waited = 0; waited < 6000; waited += 500) {
      const seen = [...data.requests, ...data.beacons];
      if (expected.every((re) => seen.some((u) => re.test(u)))) break;
      await page.waitForTimeout(500);
    }

    const evald = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /^(https?:|tel:|mailto:)/i.test(h));
      const brokenImages = Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src))
        .map((i) => i.currentSrc || i.src);
      return {
        ttfb: nav ? Math.round(nav.responseStart) : 0,
        text: document.body?.innerText ?? '',
        links,
        brokenImages,
        hasDataLayer: Array.isArray((window as unknown as { dataLayer?: unknown }).dataLayer),
        robots: Array.from(document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')).map((m) => m.getAttribute('content') ?? '').join(','),
        title: document.title.trim(),
        description: document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
        canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ?? '',
      };
    });
    data.ttfbMs = evald.ttfb;
    data.text = evald.text;
    data.links = [...new Set(evald.links)];
    data.hasDataLayer = evald.hasDataLayer;
    data.noindex = /noindex/i.test(evald.robots) || /noindex/i.test(data.headers['x-robots-tag'] ?? '');
    data.host = data.headers['x-powered-by'] ?? data.headers['server'] ?? '';
    // Anything the host throttled isn't "broken": drop those images and the console errors they caused
    // (a throttled script comes back as an HTML error page → "Refused to execute script … MIME type text/html").
    const throttled = new Set(data.rateLimited.map((u) => u.split('#')[0]));
    data.brokenImages = [...new Set(evald.brokenImages)].filter((u) => !throttled.has(u.split('#')[0]));
    data.consoleErrors = data.consoleErrors.filter((e) =>
      !(e.includes('429') || [...throttled].some((u) => e.includes(u.split('?')[0]))));
    data.title = evald.title;
    data.description = evald.description;
    data.canonical = evald.canonical;
    data.html = await page.content();
    data.gtmInHtml = [...new Set(data.html.match(/GTM-[A-Z0-9]{4,10}/g) ?? [])];
    measuringWeight = false; // resizing below loads other image sizes; weight = initial desktop load

    if (opts.a11y) {
      try {
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        data.axe = axe.violations.map((v) => ({
          id: v.id, impact: v.impact ?? 'minor', help: v.help, nodes: v.nodes.length,
          sample: String(v.nodes[0]?.target?.[0] ?? '').slice(0, 80),
        }));
      } catch (e) {
        data.axeError = (e as Error).message.split('\n')[0];
      }
    }
    if (opts.responsive || opts.screenshots) await auditViewports(page, data, opts);
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    if (/Download is starting/i.test(msg)) data.skipped = 'download';
    else data.error = msg;
  } finally {
    await ctx.close();
  }

  return data;
}

/**
 * CallRail (and similar) swap phone numbers per visitor, so every screenshot would differ.
 * Replace digits in phone-number-shaped text with 0, keeping the format (and so the layout).
 * Runs in the browser.
 */
function normalizePhoneNumbers() {
  const re = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? '';
    if (re.test(t)) n.textContent = t.replace(re, (m) => m.replace(/\d/g, '0'));
    re.lastIndex = 0;
  }
}

async function scrollThrough(page: Page) {
  // Trigger lazy-loaded images/sections so screenshots are complete.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 15000); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function auditViewports(page: Page, data: PageData, opts: LoadOptions) {
  const mask = (opts.mask ?? []).map((s) => page.locator(s));
  if (opts.screenshots) await scrollThrough(page);
  for (const vp of VIEWPORTS) {
    try {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400); // let resize handlers / media queries settle
      if (opts.responsive) {
        const raw = await page.evaluate(auditLayoutInPage, MOBILE_MAX);
        const a = { ...raw, width: vp.width };
        data.layout.push({ ...a, score: scoreLayout(a) });
      }
      if (opts.screenshots && (opts.screenshotWidths ?? SCREENSHOT_WIDTHS).includes(vp.width)) {
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
        await page.evaluate(normalizePhoneNumbers);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        const shoot = () => page.screenshot({
          fullPage: true, animations: 'disabled', caret: 'hide', mask,
          clip: { x: 0, y: 0, width: vp.width, height: Math.min(height, 8000) },
        });
        // Two shots 1.5 s apart: whatever differs between them is moving content (JS typing effects,
        // carousels, rotating testimonials) and is ignored when comparing against the baseline.
        const png = await shoot();
        await page.waitForTimeout(1500);
        await page.evaluate(normalizePhoneNumbers);
        const png2 = await shoot();
        data.screenshots.push({ width: vp.width, png: png2, previous: png });
      }
    } catch (e) {
      data.layout.push({
        width: vp.width, score: 0, overflowPx: 0, overflowCulprits: [], smallTapTargets: [], smallText: [],
        clippedText: [`audit failed: ${(e as Error).message.split('\n')[0]}`], fixedCoverPct: 0,
      });
    }
  }
}
