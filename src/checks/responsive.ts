import type { CheckResult, LayoutAudit, PageData } from '../types.js';
import { result } from '../util.js';

export const VIEWPORTS = [
  { width: 320, height: 640 },   // small phones (iPhone SE 1st gen, older Android)
  { width: 375, height: 812 },   // iPhone mini / standard
  { width: 414, height: 896 },   // large phones
  { width: 768, height: 1024 },  // tablet portrait
  { width: 1024, height: 768 },  // tablet landscape / small laptop
  { width: 1280, height: 800 },  // laptop
  { width: 1440, height: 900 },  // desktop
  { width: 1920, height: 1080 }, // full HD
];

const MOBILE_MAX = 820;

/** Screenshot widths for visual comparison (one per device class keeps storage within the free tier). */
export const SCREENSHOT_WIDTHS = [375, 768, 1280, 1920];

/**
 * Runs inside the browser (serialized by Playwright), so it must be self-contained.
 * Returns raw findings for the current window size.
 */
export function auditLayoutInPage(mobileMax: number): Omit<LayoutAudit, 'width' | 'score'> {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= mobileMax;

  const name = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = Array.from(el.classList).filter((c) => c.length < 30 && !/^(js-|is-|has-)/.test(c)).slice(0, 2);
    const self = cls.length ? `${tag}.${cls.join('.')}` : tag;
    const p = el.parentElement;
    if (!p || p === document.body) return self;
    const pName = p.id ? `#${p.id}` : p.classList[0] ? `.${p.classList[0]}` : p.tagName.toLowerCase();
    return `${pName} > ${self}`;
  };
  const shown = (el: Element, r: DOMRect) => {
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const clippedByAncestor = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const all = Array.from(document.body?.querySelectorAll('*') ?? []);

  // 1. Horizontal overflow, and the outermost elements causing it.
  const scrollW = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  const overflowPx = Math.max(0, scrollW - vw);
  const overflowCulprits: string[] = [];
  if (overflowPx > 1) {
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || !shown(el, r)) continue;
      if (getComputedStyle(el).position === 'fixed') continue; // fixed elements don't create page scroll
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && pr.right > vw + 1 && el.parentElement !== document.body) continue; // report the outermost only
      if (clippedByAncestor(el)) continue;
      overflowCulprits.push(`${name(el)} (+${Math.round(r.right - vw)}px)`);
      if (overflowCulprits.length >= 5) break;
    }
    // Fallback: the box fits but its content spills out (long URL/word, wide table, unbroken string).
    if (!overflowCulprits.length) {
      // Measure text itself: a Range around each text node gives its real painted extent.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n && overflowCulprits.length < 3; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !(n.textContent ?? '').trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width < 1 || r.right <= vw + 1 || clippedByAncestor(el)) continue;
        if (!shown(el, el.getBoundingClientRect())) continue;
        overflowCulprits.push(`${name(el)} text too wide "${(n.textContent ?? '').trim().slice(0, 40)}" (+${Math.round(r.right - vw)}px)`);
      }
    }
  }

  // 2. Tap targets under 24×24 px (WCAG 2.2 AA), mobile only. Inline links inside sentences are exempt.
  const smallTapTargets: string[] = [];
  if (isMobile) {
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button]'))) {
      const r = el.getBoundingClientRect();
      if (!shown(el, r) || r.right < 0 || r.left > vw) continue;
      // Wide-but-short links (e.g. 200×20 text links) are easy to hit; flag targets small in both directions or < 16px tall.
      if ((r.width >= 24 || r.height >= 24) && r.height >= 16) continue;
      // Checkbox/radio with a <label> are tapped via the label.
      if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type) && el.labels && el.labels.length) continue;
      const cs = getComputedStyle(el);
      if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement && text(el.parentElement).length > text(el).length + 15) continue;
      const label = `${name(el)} "${text(el).slice(0, 25) || el.getAttribute('aria-label') || ''}" ${Math.round(r.width)}×${Math.round(r.height)}`;
      if (!seen.has(label)) { seen.add(label); smallTapTargets.push(label); }
    }
  }

  // 3. Text smaller than 12px, mobile only.
  const smallText: string[] = [];
  if (isMobile) {
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || (n.textContent ?? '').trim().length < 3) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (!shown(el, r)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < 12) smallText.push(`${name(el)} ${fs}px "${text(el).slice(0, 30)}"`);
    }
  }

  // 4. Text cut off inside buttons/links/headings (no ellipsis = unintended).
  const clippedText: string[] = [];
  for (const el of Array.from(document.querySelectorAll('a, button, h1, h2, h3, h4, label, [role=button]'))) {
    const r = el.getBoundingClientRect();
    if (!shown(el, r) || !text(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible' || cs.textOverflow === 'ellipsis') continue;
    if ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 2 && (el as HTMLElement).clientWidth > 0) {
      clippedText.push(`${name(el)} "${text(el).slice(0, 30)}"`);
      if (clippedText.length >= 10) break;
    }
  }

  // 5. Screen area covered by fixed/sticky overlays at the top of the page.
  let covered = 0;
  for (const el of all) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    covered += w * h;
  }
  const fixedCoverPct = Math.min(100, Math.round((covered / (vw * vh)) * 100));

  return { overflowPx, overflowCulprits, smallTapTargets, smallText, clippedText, fixedCoverPct };
}

export function scoreLayout(a: Omit<LayoutAudit, 'score'>): number {
  let s = 100;
  if (a.overflowPx > 1) s -= 40;
  s -= Math.min(20, a.smallTapTargets.length * 2);
  s -= Math.min(15, Math.ceil(a.smallText.length * 1.5));
  s -= Math.min(20, a.clippedText.length * 5);
  if (a.fixedCoverPct > 50) s -= 25;
  else if (a.fixedCoverPct > 35 && a.width <= MOBILE_MAX) s -= 15;
  return Math.max(0, s);
}

export { MOBILE_MAX };

export function responsivePageCheck(p: PageData): CheckResult[] {
  if (!p.layout.length) return [];
  const scores = p.layout.map((a) => `${a.width}:${a.score}`).join('  ');
  const issues: string[] = [];
  for (const a of p.layout) {
    const parts: string[] = [];
    if (a.overflowPx > 1) parts.push(`horizontal scroll +${a.overflowPx}px ← ${a.overflowCulprits.join(', ') || 'unknown element'}`);
    if (a.smallTapTargets.length) parts.push(`${a.smallTapTargets.length} tap target(s) < 24px: ${a.smallTapTargets.slice(0, 3).join('; ')}`);
    if (a.smallText.length) parts.push(`${a.smallText.length} text block(s) < 12px: ${a.smallText.slice(0, 2).join('; ')}`);
    if (a.clippedText.length) parts.push(`clipped text: ${a.clippedText.slice(0, 3).join('; ')}`);
    if (a.fixedCoverPct > 35) parts.push(`fixed/sticky elements cover ${a.fixedCoverPct}% of the screen`);
    if (parts.length) issues.push(`@${a.width}px (${a.score}): ${parts.join(' | ')}`);
  }
  const anyOverflow = p.layout.some((a) => a.overflowPx > 1);
  const min = Math.min(...p.layout.map((a) => a.score));
  const status = anyOverflow ? 'fail' : min < 90 ? 'warn' : 'pass';
  return [result('responsive', 'layout', status, `Layout scores ${scores}`, p.path, issues)];
}

export function viewportAverages(pages: PageData[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { width } of VIEWPORTS) {
    const s = pages.flatMap((p) => p.layout.filter((a) => a.width === width).map((a) => a.score));
    if (s.length) out[width] = Math.round(s.reduce((x, y) => x + y, 0) / s.length);
  }
  return out;
}
