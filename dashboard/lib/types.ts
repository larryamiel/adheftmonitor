// Mirrors ../src/types.ts and supabase/schema.sql (kept separate so the dashboard deploys on its own).

export type Status = 'pass' | 'warn' | 'fail' | 'info';

export const CATEGORIES = [
  'health', 'seo', 'tracking', 'content', 'errors', 'links', 'security', 'responsive', 'visual', 'a11y', 'performance',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  health: 'Health', seo: 'SEO', tracking: 'Tracking', content: 'Content', errors: 'JS errors', links: 'Links',
  security: 'Security', responsive: 'Responsive', visual: 'Visual', a11y: 'Accessibility', performance: 'Performance',
};

export interface SiteConfig {
  label?: string;
  pages?: string[];
  keyPages?: string[];
  crawl?: { sitemap?: boolean; followLinks?: boolean; maxPages?: number; concurrency?: number; includeQuery?: boolean; exclude?: string[] };
  tracking?: {
    gtm?: string[]; ga4?: string[]; metaPixel?: string[];
    callrail?: { companyId?: string } | true;
    custom?: { name: string; pattern: string }[];
    skipPages?: string[];
  };
  consentSelector?: string;
  content?: { ignoreWords?: string[]; spellcheckCapitalized?: boolean; phones?: string[] };
  links?: { external?: boolean; ignore?: string[] };
  domain?: string;
  allowNoindex?: string[];
  visual?: { mask?: string[]; threshold?: number };
}

export interface SiteRow {
  id: string;
  name: string;
  base_url: string;
  config: SiteConfig;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type Scores = Partial<Record<Category | 'overall', number>>;

export interface Slim { id: string; page?: string; status: Status; message: string }

export interface RunRow {
  id: string;
  site_id: string;
  trigger: string;
  /** full = every page (daily) · quick = key pages (every 2h) · manual = pages you chose */
  kind: 'full' | 'quick' | 'manual';
  partial: boolean;
  status: 'running' | 'passed' | 'failed' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  pages: string[];
  scores: Scores | null;
  viewport_scores: Record<string, number> | null;
  counts: Record<Status, number> | null;
  new_issues: Slim[] | null;
  fixed: Slim[] | null;
  error: string | null;
}

export interface ResultRow {
  id: number;
  run_id: string;
  check_id: string;
  category: Category;
  status: Status;
  message: string;
  page: string | null;
  details: string[] | null;
}
