import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { result } from '../util.js';

interface Detected {
  gtm: Set<string>;
  gtmInHtml: Set<string>;
  ga4Loaded: Set<string>;
  ga4Hit: Set<string>;
  metaLoaded: Set<string>;
  metaPageView: Set<string>;
  callrail: Set<string>;
}

function detect(p: PageData): Detected {
  const d: Detected = {
    gtm: new Set(), gtmInHtml: new Set(), ga4Loaded: new Set(), ga4Hit: new Set(),
    metaLoaded: new Set(), metaPageView: new Set(), callrail: new Set(),
  };
  const all = [...p.requests, ...p.beacons];
  for (const u of all) {
    let m: RegExpMatchArray | null;
    if ((m = u.match(/\/gtm\.js\?(?:.*&)?id=(GTM-[A-Z0-9]+)/i))) d.gtm.add(m[1].toUpperCase());
    if ((m = u.match(/\/gtag\/js\?(?:.*&)?id=(G-[A-Z0-9]+)/i))) d.ga4Loaded.add(m[1].toUpperCase());
    if ((m = u.match(/\/g\/collect\?(?:.*&)?tid=(G-[A-Z0-9]+)/i))) d.ga4Hit.add(m[1].toUpperCase());
    if ((m = u.match(/connect\.facebook\.net\/signals\/config\/(\d+)/))) d.metaLoaded.add(m[1]);
    if ((m = u.match(/facebook\.com\/tr\/?[?&](?:.*&)?id=(\d+)/)) && /[?&]ev=PageView/.test(u)) d.metaPageView.add(m[1]);    if ((m = u.match(/cdn\.callrail\.com\/companies\/(\d+)\//))) d.callrail.add(m[1]);
  }
  for (const id of p.gtmInHtml) d.gtmInHtml.add(id);
  return d;
}

const fmtMissing = (pages: string[], total: number) =>
  pages.length === 0 ? `all ${total} page(s)` : `${total - pages.length}/${total} page(s)`;

export function trackingChecks(site: SiteConfig, pages: PageData[]): CheckResult[] {
  const out: CheckResult[] = [];
  const t = site.tracking ?? {};
  const skip = new Set(t.skipPages ?? []);
  const checked = pages.filter((p) => !p.error && !skip.has(p.path));
  const det = new Map(checked.map((p) => [p.path, detect(p)]));
  const n = checked.length;
  if (!n) return out;

  /** For each expected id, find pages where `has` is false. */
  const perId = (
    id: string, label: string, expected: string[] | undefined,
    strong: (d: Detected, x: string) => boolean,
    weak: (d: Detected, x: string) => boolean,
    weakMsg: string,
  ) => {
    for (const x of expected ?? []) {
      const missing = checked.filter((p) => !strong(det.get(p.path)!, x) && !weak(det.get(p.path)!, x)).map((p) => p.path);
      const weakOnly = checked.filter((p) => !strong(det.get(p.path)!, x) && weak(det.get(p.path)!, x)).map((p) => p.path);
      if (missing.length) out.push(result('tracking', id, 'fail', `${label} ${x} missing on ${missing.length}/${n} page(s)`, undefined, missing));
      else if (weakOnly.length) out.push(result('tracking', id, 'warn', `${label} ${x}: ${weakMsg} on ${weakOnly.length}/${n} page(s)`, undefined, weakOnly));
      else out.push(result('tracking', id, 'pass', `${label} ${x} firing on ${fmtMissing([], n)}`));
    }
  };

  perId('gtm', 'GTM', t.gtm,
    (d, x) => d.gtm.has(x.toUpperCase()), (d, x) => d.gtmInHtml.has(x.toUpperCase()),
    'in HTML but gtm.js never loaded');
  perId('ga4', 'GA4', t.ga4,
    (d, x) => d.ga4Hit.has(x.toUpperCase()), (d, x) => d.ga4Loaded.has(x.toUpperCase()),
    'library loaded but no page_view hit sent');
  perId('meta', 'Meta Pixel', t.metaPixel,
    (d, x) => d.metaPageView.has(x), (d, x) => d.metaLoaded.has(x),
    'pixel loaded but no PageView event');

  if (t.callrail) {
    const want = t.callrail === true ? undefined : t.callrail.companyId;
    perId('callrail', 'CallRail', [want ?? '*'],
      (d) => (want ? d.callrail.has(want) : d.callrail.size > 0), () => false, '');
  }

  for (const c of t.custom ?? []) {
    const re = new RegExp(c.pattern, 'i');
    const missing = checked.filter((p) => ![...p.requests, ...p.beacons].some((u) => re.test(u))).map((p) => p.path);
    out.push(missing.length
      ? result('tracking', `custom.${c.name}`, 'fail', `${c.name} missing on ${missing.length}/${n} page(s)`, undefined, missing)
      : result('tracking', `custom.${c.name}`, 'pass', `${c.name} present on all ${n} page(s)`));
  }

  if (t.gtm?.length) {
    const noDL = checked.filter((p) => !p.hasDataLayer).map((p) => p.path);
    out.push(noDL.length
      ? result('tracking', 'datalayer', 'fail', `window.dataLayer missing on ${noDL.length} page(s)`, undefined, noDL)
      : result('tracking', 'datalayer', 'pass', 'dataLayer present'));
  }

  // Unexpected / unconfigured tags: a rogue or stale container is a real problem.
  const union = (k: keyof Detected) => [...new Set(checked.flatMap((p) => [...det.get(p.path)![k]]))];
  const found = {
    gtm: union('gtm'),
    ga4: [...new Set([...union('ga4Hit'), ...union('ga4Loaded')])],
    meta: [...new Set([...union('metaPageView'), ...union('metaLoaded')])],
    callrail: union('callrail'),
  };
  const unexpected = [
    ...(t.gtm ? found.gtm.filter((x) => !t.gtm!.map((g) => g.toUpperCase()).includes(x)).map((x) => `GTM ${x}`) : []),
    ...(t.ga4 ? found.ga4.filter((x) => !t.ga4!.map((g) => g.toUpperCase()).includes(x)).map((x) => `GA4 ${x}`) : []),
    ...(t.metaPixel ? found.meta.filter((x) => !t.metaPixel!.includes(x)).map((x) => `Meta ${x}`) : []),
  ];
  if (unexpected.length) out.push(result('tracking', 'unexpected', 'warn', 'Unexpected tracking IDs found (stale/duplicate tags?)', undefined, unexpected));

  const summary = [
    found.gtm.length && `GTM: ${found.gtm.join(', ')}`,
    found.ga4.length && `GA4: ${found.ga4.join(', ')}`,
    found.meta.length && `Meta: ${found.meta.join(', ')}`,
    found.callrail.length && `CallRail: ${found.callrail.join(', ')}`,
  ].filter(Boolean) as string[];
  const configured = !!(t.gtm || t.ga4 || t.metaPixel || t.callrail || t.custom);
  out.push(result('tracking', 'detected', configured ? 'info' : 'warn',
    configured ? 'Detected tags' : 'No expected tags configured; add these to sites.config.ts to enforce them',
    undefined, summary.length ? summary : ['No known tags detected']));

  return out;
}
