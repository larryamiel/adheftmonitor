import nspell from 'nspell';
import dictionaryEn from 'dictionary-en';
import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { digits, result, truncate } from '../util.js';

// Common web/marketing words missing from the Hunspell en-US dictionary.
const WEB_WORDS = [
  'email', 'emails', 'online', 'website', 'websites', 'login', 'signup', 'ecommerce', 'checkout', 'homepage',
  'webinar', 'webinars', 'blog', 'blogs', 'app', 'apps', 'faq', 'faqs', 'url', 'urls', 'wifi', 'cookie', 'cookies',
  'analytics', 'dropdown', 'onboarding', 'workflow', 'workflows', 'dashboard', 'dashboards', 'username', 'ok',
  'healthcare', 'eg', 'ie', 'etc', 'vs', 'pdf', 'covid', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok',
  'google', 'iphone', 'android', 'smartphone', 'startup', 'startups', 'livestream', 'unsubscribe', 'opt', 'hvac',
  'integrations', 'automations', 'workflows', 'chatbot', 'chatbots', 'plugin', 'plugins', 'signups', 'logins',
  'omnichannel', 'reschedule', 'rebrand', 'onsite', 'offsite', 'telehealth', 'walkthrough', 'roofing', 'subcontractor',
];

let speller: ReturnType<typeof nspell> | undefined;
function getSpeller(extra: string[]) {
  if (!speller) {
    speller = nspell({ aff: Buffer.from(dictionaryEn.aff), dic: Buffer.from(dictionaryEn.dic) });
    for (const w of WEB_WORDS) speller.add(w);
  }
  for (const w of extra) speller.add(w), speller.add(w.toLowerCase());
  return speller;
}

export function spellcheck(site: SiteConfig, p: PageData): CheckResult {
  const lang = p.html.match(/<html[^>]*\blang=["']?([\w-]+)/i)?.[1];
  if (lang && !/^en\b/i.test(lang)) return result('content', 'spelling', 'info', `Spellcheck skipped (lang="${lang}")`, p.path);
  const sp = getSpeller(site.content?.ignoreWords ?? []);
  const text = p.text
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g, ' ') // urls, emails
    .replace(/\b[\w-]+\.(?:com|net|org|io|co|us|ai|app|biz|info|dev)\b\S*/gi, ' ') // bare domains
    .replace(/\b[A-Za-z]+-(?=[A-Za-z])/g, (m) => m.replace('-', ' ')) // pre-built → pre built
    .replace(/\b(?:pre|non|co|re|un|multi|anti|semi)\s/gi, ' ')
    .replace(/[’‘]/g, "'");
  const bad = new Map<string, number>();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z']*[A-Za-z]/g)) {
    const w = m[0].replace(/'s$/i, '');
    if (w.length < 3) continue;
    if (/[A-Z]{2,}/.test(w) || /[a-z][A-Z]/.test(w)) continue; // ACRONYMS, camelCase brand names
    // Capitalized words are mostly names/places; skipping them keeps noise low. Opt in per site.
    if (/^[A-Z]/.test(w) && !site.content?.spellcheckCapitalized) continue;
    if (sp.correct(w) || sp.correct(w.toLowerCase())) continue;
    bad.set(w, (bad.get(w) ?? 0) + 1);
  }
  if (!bad.size) return result('content', 'spelling', 'pass', 'No spelling issues', p.path);
  const details = [...bad.entries()].slice(0, 25).map(([w, n]) => {
    const s = sp.suggest(w).slice(0, 3);
    return `${w}${n > 1 ? ` ×${n}` : ''}${s.length ? ` → ${s.join(', ')}` : ''}`;
  });
  return result('content', 'spelling', 'warn', `${bad.size} possible misspelling(s)`, p.path, details);
}

const PLACEHOLDERS: [RegExp, string, 'fail' | 'warn'][] = [
  [/lorem ipsum/i, 'Lorem ipsum', 'fail'],
  [/\[object Object\]/, '[object Object]', 'fail'],
  [/\bundefined\b/, '"undefined"', 'fail'],
  [/\bNaN\b/, '"NaN"', 'fail'],
  [/\{\{[^}]*\}\}|\{%[^%]*%\}/, 'Unrendered template tag', 'fail'],
  [/\[(insert|your|add|enter|placeholder)[^\]]*\]/i, 'Bracket placeholder', 'fail'],
  [/\b(TODO|FIXME|TBD|XXX)\b/, 'TODO/FIXME/TBD', 'warn'],
  [/\b(test test|asdf|qwerty)\b/i, 'Test text', 'warn'],
  [/\b(555[-.\s]?\d{3}[-.\s]?\d{4})\b/, 'Fake 555 phone number', 'warn'],
];

const LEAKED_HOSTS = /\b(localhost|127\.0\.0\.1|[\w-]+\.(?:vercel\.app|netlify\.app|wpengine\.com|wpenginepowered\.com|kinsta\.cloud|herokuapp\.com)|(?:staging|stage|dev|test|qa|uat)\d*\.[\w.-]+\.\w+)\b/gi;

export function contentChecks(site: SiteConfig, p: PageData): CheckResult[] {
  const out: CheckResult[] = [spellcheck(site, p)];
  const add = (id: string, s: CheckResult['status'], msg: string, d?: string[]) => out.push(result('content', id, s, msg, p.path, d));

  const hits = PLACEHOLDERS.flatMap(([re, label, sev]) => {
    const m = p.text.match(re);
    if (!m) return [];
    const i = m.index ?? 0;
    return [{ label, sev, ctx: truncate(p.text.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' '), 110) }];
  });
  if (hits.length) add('placeholders', hits.some((h) => h.sev === 'fail') ? 'fail' : 'warn',
    `Placeholder / junk text: ${hits.map((h) => h.label).join(', ')}`, hits.map((h) => `${h.label}: "…${h.ctx}…"`));
  else add('placeholders', 'pass', 'No placeholder text');

  const ownHost = new URL(site.baseUrl).hostname.toLowerCase();
  const ownRoot = ownHost.replace(/^www\./, '');
  const attrUrls = [...p.html.matchAll(/(?:href|src|action)=["']([^"']+)["']/gi)].map((m) => m[1]);
  const leaked = [...new Set(attrUrls.flatMap((u) => [...u.matchAll(LEAKED_HOSTS)].map((m) => m[0].toLowerCase())))]
    .filter((h) => h !== ownHost)
    // "dev.vendor.com" is a vendor's real domain; only flag staging/dev subdomains of YOUR domain.
    .filter((h) => !/^(staging|stage|dev|test|qa|uat)\d*\./.test(h) || h.endsWith('.' + ownRoot));
  if (leaked.length) add('leaked-urls', 'fail', 'Links/assets point to staging/dev hosts', leaked);
  else add('leaked-urls', 'pass', 'No staging/dev URLs');

  const year = new Date().getFullYear();
  const cr = p.text.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i);
  if (cr && Number(cr[1]) < year) add('copyright', 'warn', `Copyright year is ${cr[1]} (now ${year})`);
  else if (cr) add('copyright', 'pass', `Copyright ${cr[1]}`);

  const tels = p.links.filter((l) => l.startsWith('tel:'));
  const badTel = tels.filter((t) => { const d = digits(t); return d.length < 10 || d.length > 15; });
  const allowed = site.content?.phones?.map(digits);
  const unknownTel = allowed
    ? tels.filter((t) => { const d = digits(t); return !allowed.some((a) => d.endsWith(a) || a.endsWith(d)); })
    : [];
  if (badTel.length) add('tel-links', 'fail', 'Malformed tel: links', badTel);
  else if (unknownTel.length) add('tel-links', 'warn', 'Phone numbers not in your allowed list', [...new Set(unknownTel)]);
  else if (tels.length) add('tel-links', 'pass', `${new Set(tels).size} tel: link(s) OK`);

  const badMail = p.links.filter((l) => l.startsWith('mailto:') && !/^mailto:[^@\s]+@[^@\s]+\.\w+/i.test(decodeURIComponent(l)));
  if (badMail.length) add('mailto-links', 'fail', 'Malformed mailto: links', badMail);

  return out;
}
