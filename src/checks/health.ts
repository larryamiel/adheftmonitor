import tls from 'node:tls';
import type { CheckResult, PageData, SiteConfig } from '../types.js';
import { fetchWithTimeout, redirectChain, result } from '../util.js';

export function healthPageChecks(p: PageData): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (id: string, s: CheckResult['status'], msg: string) => out.push(result('health', id, s, msg, p.path));
  if (p.error) { add('load', 'fail', `Page failed to load: ${p.error}`); return out; }

  if (p.status >= 200 && p.status < 300) add('status', 'pass', `HTTP ${p.status}`);
  else add('status', 'fail', `HTTP ${p.status}`);

  if (p.ttfbMs > 1800) add('ttfb', 'fail', `Slow server response: TTFB ${p.ttfbMs} ms`);
  else if (p.ttfbMs > 800) add('ttfb', 'warn', `TTFB ${p.ttfbMs} ms (aim < 800)`);
  else add('ttfb', 'pass', `TTFB ${p.ttfbMs} ms`);

  if (p.loadMs > 10_000) add('load', 'fail', `Load event took ${(p.loadMs / 1000).toFixed(1)} s`);
  else if (p.loadMs > 5_000) add('load', 'warn', `Load event took ${(p.loadMs / 1000).toFixed(1)} s`);
  else add('load', 'pass', `Loaded in ${(p.loadMs / 1000).toFixed(1)} s`);
  return out;
}

function certExpiry(host: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!sock.authorized) return reject(new Error(`Certificate not trusted: ${sock.authorizationError}`));
      resolve(new Date(cert.valid_to));
    });
    sock.on('error', reject);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS timeout')); });
  });
}

const daysUntil = (d: Date) => Math.floor((d.getTime() - Date.now()) / 86_400_000);

export async function healthSiteChecks(site: SiteConfig): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const base = new URL(site.baseUrl);

  // SSL
  if (base.protocol === 'https:') {
    try {
      const days = daysUntil(await certExpiry(base.hostname));
      out.push(result('health', 'ssl', days < 14 ? 'fail' : days < 30 ? 'warn' : 'pass', `SSL certificate expires in ${days} day(s)`));
    } catch (e) {
      out.push(result('health', 'ssl', 'fail', `SSL problem: ${(e as Error).message}`));
    }
  }

  // Domain expiry via RDAP (free, no key)
  const domain = site.domain ?? base.hostname.split('.').slice(-2).join('.');
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, { timeoutMs: 15_000 });
    if (res.ok) {
      const j = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] };
      const exp = j.events?.find((e) => e.eventAction === 'expiration');
      if (exp) {
        const days = daysUntil(new Date(exp.eventDate));
        out.push(result('health', 'domain-expiry', days < 14 ? 'fail' : days < 45 ? 'warn' : 'pass', `Domain ${domain} expires in ${days} day(s)`));
      } else out.push(result('health', 'domain-expiry', 'info', `Registry for ${domain} does not publish expiry`));
    } else out.push(result('health', 'domain-expiry', 'info', `RDAP lookup unavailable for ${domain} (${res.status})`));
  } catch {
    out.push(result('health', 'domain-expiry', 'info', `RDAP lookup failed for ${domain}`));
  }

  // Redirect variants all land on the canonical origin in ≤ 2 hops
  const bare = base.hostname.replace(/^www\./, '');
  const variants = [`http://${bare}/`, `http://www.${bare}/`, `https://${bare}/`, `https://www.${bare}/`]
    .filter((v) => v !== `${base.origin}/`);
  for (const v of variants) {
    try {
      const chain = await redirectChain(v);
      const last = chain[chain.length - 1];
      const hops = chain.length - 1;
      const landed = new URL(last.url);
      const label = `${v} → ${last.url} (${hops} hop${hops === 1 ? '' : 's'}, ${last.status})`;
      if (landed.origin !== base.origin || last.status >= 400) out.push(result('health', 'redirects', 'fail', `Doesn't land on ${base.origin}: ${label}`));
      else if (hops > 2) out.push(result('health', 'redirects', 'warn', `Redirect chain: ${label}`, undefined, chain.map((c) => `${c.status} ${c.url}`)));
      else out.push(result('health', 'redirects', 'pass', label));
    } catch (e) {
      // Variant host (e.g. www) may simply not exist; only a problem for http of the canonical host.
      const severity = new URL(v).hostname === base.hostname ? 'fail' : 'info';
      out.push(result('health', 'redirects', severity, `${v} unreachable: ${(e as Error).cause ?? (e as Error).message}`));
    }
  }

  // Real 404 (not a soft 404)
  try {
    const res = await fetchWithTimeout(`${site.baseUrl}/adheft-monitor-404-check-${Date.now()}`);
    out.push(res.status === 404 || res.status === 410
      ? result('health', '404-page', 'pass', 'Missing pages return 404')
      : result('health', '404-page', 'warn', `Missing pages return ${res.status} (soft 404 hurts SEO)`));
  } catch (e) {
    out.push(result('health', '404-page', 'warn', `404 check failed: ${(e as Error).message}`));
  }

  return out;
}
