export type Status = 'pass' | 'warn' | 'fail' | 'info';

export type Category =
  | 'health'
  | 'seo'
  | 'tracking'
  | 'content'
  | 'errors'
  | 'links'
  | 'security'
  | 'responsive'
  | 'visual'
  | 'a11y'
  | 'performance';

export interface CheckResult {
  /** Stable id, e.g. "seo.title". Combined with `page` it identifies a result across runs. */
  id: string;
  category: Category;
  status: Status;
  message: string;
  /** Page path the result belongs to; undefined = site-level. */
  page?: string;
  details?: string[];
}

export interface TrackingConfig {
  /** Expected GTM container IDs, e.g. ["GTM-ABC123"]. */
  gtm?: string[];
  /** Expected GA4 measurement IDs, e.g. ["G-XXXXXXX"]. */
  ga4?: string[];
  /** Expected Meta Pixel IDs. */
  metaPixel?: string[];
  /** CallRail: company ID from the swap.js URL (cdn.callrail.com/companies/<id>/...). true = just require swap.js. */
  callrail?: { companyId?: string } | true;
  /** Any other tag: passes if a network request URL matches the regex. */
  custom?: { name: string; pattern: string }[];
  /** Pages where tracking is NOT expected (e.g. thank-you pages handled separately). */
  skipPages?: string[];
}

export interface SiteConfig {
  /** Short unique name used on the CLI: --site <name>. */
  name: string;
  /** Canonical origin, e.g. "https://www.example.com". */
  baseUrl: string;
  /** Paths always checked. Default ["/"]. */
  pages?: string[];
  crawl?: {
    /** Add URLs from /sitemap.xml. Default true. */
    sitemap?: boolean;
    /** Follow internal links found on pages. Default true. */
    followLinks?: boolean;
    /** Cap on pages per run. Default: no cap (all pages, safety limit 5000). */
    maxPages?: number;
    /** Pages loaded in parallel. Default 4. */
    concurrency?: number;
    /** Treat ?query variants as separate pages. Default false (query is stripped, avoids crawl traps). */
    includeQuery?: boolean;
    /** Path regexes to never crawl, e.g. ["^/wp-admin", "\\?"]. */
    exclude?: string[];
  };
  tracking?: TrackingConfig;
  /** Click this selector (cookie banner "Accept") before checking tracking. */
  consentSelector?: string;
  content?: {
    /** Extra words the spellchecker should accept (brand names, cities, jargon). */
    ignoreWords?: string[];
    /** Also spellcheck Capitalized words (noisier: proper nouns). Default false. */
    spellcheckCapitalized?: boolean;
    /** Allowed phone numbers (digits only compared). If set, any other tel: number warns. */
    phones?: string[];
  };
  links?: {
    /** Check external links. Default true. */
    external?: boolean;
    /** URL regexes to skip. */
    ignore?: string[];
  };
  /** Registrable domain for expiry lookup if not derivable (e.g. "example.co.uk"). */
  domain?: string;
  /** Pages allowed to be noindex (e.g. "/thank-you"). */
  allowNoindex?: string[];
  /**
   * Key pages get the expensive checks: screenshot comparison at every width + PageSpeed Insights.
   * Default: "/" plus `pages`. (Layout/responsive + accessibility checks run on ALL pages.)
   */
  keyPages?: string[];
  visual?: {
    /** CSS selectors to blank out before screenshots (carousels, rotating testimonials, dates). */
    mask?: string[];
    /** % of changed pixels that counts as a visual change. Default 0.5. */
    threshold?: number;
  };
}

export interface LayoutAudit {
  width: number;
  /** 0–100 for this page at this width. */
  score: number;
  /** px the page is wider than the screen (0 = no horizontal scroll). */
  overflowPx: number;
  overflowCulprits: string[];
  smallTapTargets: string[];
  smallText: string[];
  clippedText: string[];
  /** % of the screen covered by fixed/sticky elements (cookie bars, chat widgets, headers). */
  fixedCoverPct: number;
}

export interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: number;
  sample: string;
}

export interface Screenshot {
  width: number;
  png: Buffer;
  /** Same view 1.5 s earlier: pixels that differ between the two are moving content. */
  previous?: Buffer;
}

export interface PageData {
  url: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  text: string;
  ttfbMs: number;
  loadMs: number;
  requests: string[];
  /** Analytics beacons we intercepted (never sent). */
  beacons: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number | string; resourceType: string }[];
  brokenImages: string[];
  links: string[];
  hasDataLayer: boolean;
  /** GTM IDs present in the HTML source (kept after html is released). */
  gtmInHtml: string[];
  title: string;
  description: string;
  error?: string;
  /** Set when the URL isn't an HTML page (PDF, image, download): not checked. */
  skipped?: string;
  layout: LayoutAudit[];
  axe: AxeViolation[];
  axeError?: string;
  screenshots: Screenshot[];
  /** Transferred bytes by resource type (from content-length; approximate). */
  weight: { total: number; byType: Record<string, number>; largeImages: { url: string; bytes: number }[] };
}

export interface SiteReport {
  site: string;
  baseUrl: string;
  startedAt: string;
  durationMs: number;
  pages: string[];
  results: CheckResult[];
  scores: Record<Category | 'overall', number>;
  /** Average layout score per screen width across all pages, e.g. {"320": 81, "1920": 100}. */
  viewportScores?: Record<string, number>;
}
