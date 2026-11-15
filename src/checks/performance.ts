import pLimit from 'p-limit';
import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { fetchWithTimeout, result, truncate } from '../util.js';

const MB = 1024 * 1024;
const kb = (b: number) => `${Math.round(b / 1024)} KB`;

export function weightPageCheck(p: PageData): CheckResult[] {
  const out: CheckResult[] = [];
  const { byType, largeImages } = p.weight;
  const breakdown = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, b]) => `${t}: ${kb(b)}`);
  // Video/audio streams are reported on their own: a background video shouldn't make the page "fail".
  const media = byType.media ?? 0;
  const total = p.weight.total - media;
  const mb = (total / MB).toFixed(1);
  if (media > 5 * MB) {
    out.push(result('performance', 'video-weight', 'warn',
      `Video/audio downloads ${(media / MB).toFixed(1)} MB on load (heavy on mobile data; consider a poster image or preload="none")`, p.path));
  }
  out.push(total > 10 * MB
    ? result('performance', 'weight', 'fail', `Page weight ${mb} MB (aim < 3 MB)`, p.path, breakdown)
    : total > 5 * MB
      ? result('performance', 'weight', 'warn', `Page weight ${mb} MB (aim < 3 MB)`, p.path, breakdown)
      : result('performance', 'weight', 'pass', `Page weight ${mb} MB`, p.path));
  if (largeImages.length) {
    out.push(result('performance', 'large-images', 'warn', `${largeImages.length} image(s) over 300 KB (compress / use WebP or AVIF)`, p.path,
      largeImages.sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((i) => `${kb(i.bytes)}  ${truncate(i.url)}`)));
  }
  return out;
}

interface Psi {
  lighthouseResult?: {
    categories?: { performance?: { score: number } };
    audits?: Record<string, { numericValue?: number; displayValue?: string }>;
  };
  loadingExperience?: {
    overall_category?: string;
    metrics?: Record<string, { percentile: number; category: string }>;
  };
  error?: { message: string; code: number };
}

const grade = (v: number, good: number, poor: number) => (v > poor ? 'fail' : v > good ? 'warn' : 'pass');

/** Google PageSpeed Insights (Lighthouse lab score + real-user Core Web Vitals) for key pages. */
export async function pageSpeedChecks(site: SiteConfig, keyPaths: string[]): Promise<CheckResult[]> {
  const key = process.env.PSI_API_KEY;
  const limit = pLimit(4);
  const jobs = keyPaths.flatMap((path) => (['mobile', 'desktop'] as const).map((strategy) => ({ path, strategy })));
  const out = await Promise.all(jobs.map(({ path, strategy }) => limit(async (): Promise<CheckResult[]> => {
    const target = site.baseUrl + path;
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(target)}` +
      `&strategy=${strategy}&category=performance${key ? `&key=${key}` : ''}`;
    const id = `psi-${strategy}`;
    try {
      const res = await fetchWithTimeout(api, { timeoutMs: 120_000 });
      const j = (await res.json()) as Psi;
      if (!res.ok || j.error) {
        const msg = j.error?.message ?? `HTTP ${res.status}`;
        return [result('performance', id, 'info', `PageSpeed (${strategy}) unavailable: ${truncate(msg, 100)}${key ? '' : ' (set PSI_API_KEY)'}`, path)];
      }
      const results: CheckResult[] = [];
      const score = Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
      const a = j.lighthouseResult?.audits ?? {};
      const lab = ['largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']
        .map((k) => a[k]?.displayValue && `${k.replace(/-/g, ' ')}: ${a[k].displayValue}`).filter(Boolean) as string[];
      results.push(result('performance', id, score < 50 ? 'fail' : score < 90 ? 'warn' : 'pass',
        `PageSpeed ${strategy}: ${score}/100`, path, lab));

      // Real-user data (Chrome UX Report): only exists for pages with enough traffic.
      const m = j.loadingExperience?.metrics;
      if (m && strategy === 'mobile') {
        const lcp = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
        const inp = m.INTERACTION_TO_NEXT_PAINT?.percentile;
        const cls = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
        const parts: [string, number | undefined, string][] = [
          ['LCP', lcp, lcp !== undefined ? `${(lcp / 1000).toFixed(1)} s` : ''],
          ['INP', inp, inp !== undefined ? `${inp} ms` : ''],
          ['CLS', cls, cls !== undefined ? (cls / 100).toFixed(2) : ''],
        ];
        const statuses = [
          lcp !== undefined ? grade(lcp, 2500, 4000) : 'pass',
          inp !== undefined ? grade(inp, 200, 500) : 'pass',
          cls !== undefined ? grade(cls, 10, 25) : 'pass',
        ];
        const worst = statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass';
        results.push(result('performance', 'core-web-vitals', worst,
          `Core Web Vitals (real users, mobile): ${parts.filter((p) => p[1] !== undefined).map((p) => `${p[0]} ${p[2]}`).join(' · ')}`, path));
      }
      return results;
    } catch (e) {
      return [result('performance', id, 'info', `PageSpeed (${strategy}) failed: ${(e as Error).message}`, path)];
    }
  })));
  return out.flat();
}
