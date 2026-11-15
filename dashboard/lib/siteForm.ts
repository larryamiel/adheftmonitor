import type { SiteConfig } from './types';

/** Lines or commas → trimmed non-empty strings. */
const list = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
const str = (v: FormDataEntryValue | null) => String(v ?? '').trim() || undefined;
const bool = (v: FormDataEntryValue | null) => v === 'on';

const path = (p: string) => (p.startsWith('/') ? p : `/${p}`);

/** Drop undefined / empty arrays / empty objects so stored config stays minimal. */
function prune<T>(o: T): T {
  if (Array.isArray(o)) return o;
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const pv = prune(v);
      if (pv === undefined || pv === '' || (Array.isArray(pv) && !pv.length)) continue;
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && !Object.keys(pv).length) continue;
      out[k] = pv;
    }
    return out as T;
  }
  return o;
}

export function parseSiteForm(f: FormData): { name: string; baseUrl: string; enabled: boolean; config: SiteConfig } {
  const name = String(f.get('name') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Name must be lowercase letters, numbers and dashes (e.g. "acme-plumbing")');
  let baseUrl: string;
  try {
    const u = new URL(String(f.get('baseUrl') ?? '').trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    baseUrl = u.origin;
  } catch {
    throw new Error('Website URL must be a full URL, e.g. https://www.example.com');
  }

  const custom = lines(f.get('customTags')).map((l) => {
    const [n, ...rest] = l.split('|');
    const pattern = rest.join('|').trim();
    if (!n?.trim() || !pattern) throw new Error(`Custom tag line must be "Name | regex": ${l}`);
    try { new RegExp(pattern); } catch { throw new Error(`Invalid regex for ${n.trim()}: ${pattern}`); }
    return { name: n.trim(), pattern };
  });
  for (const r of [...lines(f.get('exclude')), ...lines(f.get('linkIgnore'))]) {
    try { new RegExp(r); } catch { throw new Error(`Invalid regex: ${r}`); }
  }

  const callrailMode = String(f.get('callrail') ?? 'off');
  const callrailId = str(f.get('callrailId'));
  const maxPages = Number(f.get('maxPages'));
  const threshold = Number(f.get('threshold'));

  const config: SiteConfig = prune({
    pages: list(f.get('pages')).map(path),
    keyPages: list(f.get('keyPages')).map(path),
    crawl: {
      maxPages: Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : undefined,
      exclude: lines(f.get('exclude')),
      includeQuery: bool(f.get('includeQuery')) || undefined,
    },
    tracking: {
      gtm: list(f.get('gtm')).map((s) => s.toUpperCase()),
      ga4: list(f.get('ga4')).map((s) => s.toUpperCase()),
      metaPixel: list(f.get('metaPixel')),
      callrail: callrailMode === 'off' ? undefined : callrailId ? { companyId: callrailId } : true,
      custom,
      skipPages: list(f.get('trackingSkip')).map(path),
    },
    consentSelector: str(f.get('consentSelector')),
    content: {
      ignoreWords: list(f.get('ignoreWords')),
      phones: list(f.get('phones')),
      spellcheckCapitalized: bool(f.get('spellcheckCapitalized')) || undefined,
    },
    links: {
      external: bool(f.get('externalLinks')) ? undefined : false,
      ignore: lines(f.get('linkIgnore')),
    },
    allowNoindex: list(f.get('allowNoindex')).map(path),
    visual: {
      mask: lines(f.get('mask')),
      threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : undefined,
    },
    domain: str(f.get('domain')),
  });
  return { name, baseUrl, enabled: bool(f.get('enabled')), config };
}
