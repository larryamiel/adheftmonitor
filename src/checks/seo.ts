import * as cheerio from 'cheerio';
import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { fetchWithTimeout, result, truncate } from '../util.js';

/**
 * `mustIndex`: the page is the home page, a key page, or listed in the sitemap. noindex there contradicts
 * itself and is a real SEO bug; elsewhere (archives, utility pages) it's usually intentional.
 */
export function seoPageChecks(site: SiteConfig, p: PageData, mustIndex = true): CheckResult[] {
  const out: CheckResult[] = [];
  const $ = cheerio.load(p.html);
  const add = (id: string, status: CheckResult['status'], msg: string, details?: string[]) =>
    out.push(result('seo', id, status, msg, p.path, details));

  // noindex: meta tag and HTTP header
  const robotsMeta = $('meta[name="robots"], meta[name="googlebot"]').map((_, el) => $(el).attr('content') ?? '').get().join(',');
  const xRobots = p.headers['x-robots-tag'] ?? '';
  const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(xRobots);
  const allowed = site.allowNoindex?.some((a) => p.path === a || p.path.startsWith(a + '/'));
  const how = robotsMeta || 'X-Robots-Tag: ' + xRobots;
  if (noindex && !allowed && mustIndex) add('noindex', 'fail', `Page is noindex but should be indexed (home, key page or in sitemap): ${how}`);
  else if (noindex) add('noindex', 'info', `Page is noindex (not in sitemap, likely intentional): ${how}`);
  else add('noindex', 'pass', 'Indexable');

  const title = $('head title').first().text().trim();
  if (!title) add('title', 'fail', 'Missing <title>');
  else if (title.length < 15 || title.length > 60) add('title', 'warn', `Title length ${title.length} (aim 15–60): "${truncate(title, 80)}"`);
  else add('title', 'pass', `Title OK (${title.length} chars)`);

  const desc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  if (!desc) add('description', 'fail', 'Missing meta description');
  else if (desc.length < 50 || desc.length > 160) add('description', 'warn', `Meta description length ${desc.length} (aim 50–160)`);
  else add('description', 'pass', `Meta description OK (${desc.length} chars)`);

  const h1s = $('h1').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get();
  if (h1s.length === 0) add('h1', 'fail', 'No <h1>');
  else if (h1s.length > 1) add('h1', 'warn', `${h1s.length} <h1> tags (use one)`, h1s.map((h) => truncate(h, 80)));
  else add('h1', 'pass', 'One <h1>');

  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical) add('canonical', 'warn', 'No canonical tag');
  else {
    try {
      const c = new URL(canonical, p.url);
      const base = new URL(site.baseUrl);
      if (c.host !== base.host) add('canonical', 'fail', `Canonical points to another host: ${c.href}`);
      else if (c.pathname.replace(/\/$/, '') !== new URL(p.url).pathname.replace(/\/$/, ''))
        add('canonical', 'info', `Canonical points elsewhere: ${c.pathname}`);
      else add('canonical', 'pass', 'Self-referencing canonical');
    } catch {
      add('canonical', 'fail', `Invalid canonical: ${canonical}`);
    }
  }

  if (!$('html').attr('lang')) add('lang', 'warn', 'Missing <html lang>');
  else add('lang', 'pass', `lang="${$('html').attr('lang')}"`);

  if (!$('meta[name="viewport"]').length) add('viewport', 'fail', 'Missing viewport meta (mobile will break)');
  else add('viewport', 'pass', 'Viewport meta present');

  const ogMissing = ['og:title', 'og:description', 'og:image'].filter((k) => !$(`meta[property="${k}"]`).attr('content'));
  if (ogMissing.length) add('opengraph', 'warn', `Missing Open Graph: ${ogMissing.join(', ')}`);
  else add('opengraph', 'pass', 'Open Graph tags present');

  const noAlt = [...new Set($('img:not([alt])').map((_, el) => $(el).attr('src') ?? '(no src)').get())];
  if (noAlt.length) add('img-alt', 'warn', `${noAlt.length} image(s) missing alt attribute`, noAlt.slice(0, 10).map((s) => truncate(s)));
  else add('img-alt', 'pass', 'All images have alt');

  const ldErrors: string[] = [];
  const ldTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      const items = Array.isArray(j) ? j : j['@graph'] ?? [j];
      for (const it of items) if (it?.['@type']) ldTypes.push(String(it['@type']));
    } catch (e) {
      ldErrors.push((e as Error).message);
    }
  });
  if (ldErrors.length) add('jsonld', 'fail', 'Invalid JSON-LD structured data', ldErrors);
  else if (ldTypes.length) add('jsonld', 'pass', `Structured data: ${[...new Set(ldTypes)].join(', ')}`);
  else add('jsonld', 'info', 'No structured data');

  return out;
}

/** Cross-page checks: duplicate titles / descriptions. */
export function seoCrossPageChecks(pages: PageData[]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const [id, field] of [['duplicate-titles', 'title'], ['duplicate-descriptions', 'description']] as const) {
    const map = new Map<string, string[]>();
    for (const p of pages) if (p[field]) map.set(p[field], [...(map.get(p[field]) ?? []), p.path]);
    const dups = [...map.entries()].filter(([, ps]) => ps.length > 1);
    out.push(
      dups.length
        ? result('seo', id, 'warn', `${dups.length} duplicated value(s) across pages`, undefined,
            dups.map(([v, ps]) => `"${truncate(v, 60)}" -> ${ps.slice(0, 5).join(', ')}${ps.length > 5 ? ` +${ps.length - 5} more` : ''}`))
        : result('seo', id, 'pass', 'No duplicates'),
    );
  }
  return out;
}

export async function robotsAndSitemap(site: SiteConfig): Promise<{ results: CheckResult[]; sitemapUrls: string[] }> {
  const out: CheckResult[] = [];
  let sitemapUrls: string[] = [];
  let sitemapLocations = [`${site.baseUrl}/sitemap.xml`];

  try {
    const res = await fetchWithTimeout(`${site.baseUrl}/robots.txt`);
    if (!res.ok) out.push(result('seo', 'robots', 'warn', `robots.txt returned ${res.status}`));
    else {
      const txt = await res.text();
      // Look for "Disallow: /" inside a "User-agent: *" group.
      const groups = txt.split(/\n(?=\s*user-agent)/i);
      const blocking = groups.some(
        (g) => /user-agent:\s*\*/i.test(g) && /^\s*disallow:\s*\/\s*$/im.test(g),
      );
      out.push(blocking
        ? result('seo', 'robots', 'fail', 'robots.txt blocks the whole site (User-agent: * / Disallow: /)')
        : result('seo', 'robots', 'pass', 'robots.txt allows crawling'));
      const declared = [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      if (declared.length) sitemapLocations = declared;
      else out.push(result('seo', 'robots-sitemap', 'warn', 'robots.txt does not declare a Sitemap'));
    }
  } catch (e) {
    out.push(result('seo', 'robots', 'warn', `robots.txt unreachable: ${(e as Error).message}`));
  }

  try {
    sitemapUrls = await readSitemap(sitemapLocations[0]);
    out.push(sitemapUrls.length
      ? result('seo', 'sitemap', 'pass', `Sitemap has ${sitemapUrls.length} URL(s)`)
      : result('seo', 'sitemap', 'fail', `Sitemap empty or invalid: ${sitemapLocations[0]}`));
    const foreign = sitemapUrls.filter((u) => { try { return new URL(u).host !== new URL(site.baseUrl).host; } catch { return true; } });
    if (foreign.length) out.push(result('seo', 'sitemap-hosts', 'warn', `${foreign.length} sitemap URL(s) on another host`, undefined, foreign.slice(0, 10)));
  } catch (e) {
    out.push(result('seo', 'sitemap', 'fail', `Sitemap unreachable: ${(e as Error).message}`));
  }

  return { results: out, sitemapUrls };
}

async function readSitemap(url: string, depth = 0): Promise<string[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const $ = cheerio.load(await res.text(), { xml: true });
  const locs = $('loc').map((_, el) => $(el).text().trim()).get();
  if ($('sitemapindex').length && depth < 2) {
    const nested = await Promise.all(locs.slice(0, 10).map((u) => readSitemap(u, depth + 1).catch(() => [])));
    return nested.flat();
  }
  return locs;
}
