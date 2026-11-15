import type { CheckResult, PageData } from '../types.js';
import { result } from '../util.js';

export function securityChecks(home: PageData): CheckResult[] {
  const h = home.headers;
  const add = (id: string, ok: boolean, okMsg: string, badMsg: string, sev: 'warn' | 'fail' = 'warn') =>
    result('security', id, ok ? 'pass' : sev, ok ? okMsg : badMsg);
  const csp = h['content-security-policy'] ?? '';
  const rec = (id: string, ok: boolean, okMsg: string, badMsg: string) => result('security', id, ok ? 'pass' : 'info', ok ? okMsg : badMsg);
  // A version number ("PHP/8.1", "nginx/1.25") helps attackers; a product name alone ("WP Engine") doesn't.
  const leaks = /\d/.test(h['x-powered-by'] ?? '') || /\/\d/.test(h['server'] ?? '');
  return [
    add('hsts', !!h['strict-transport-security'], 'HSTS enabled', 'Missing Strict-Transport-Security header'),
    // Recommendations (most hosts, incl. WP Engine, don't send these by default): info, not warnings.
    rec('nosniff', /nosniff/i.test(h['x-content-type-options'] ?? ''), 'X-Content-Type-Options: nosniff', 'Recommended: X-Content-Type-Options: nosniff'),
    rec('clickjacking', !!h['x-frame-options'] || /frame-ancestors/i.test(csp),
      'Clickjacking protection set', 'Recommended: X-Frame-Options or CSP frame-ancestors (stops the site being framed)'),
    rec('referrer-policy', !!h['referrer-policy'], `Referrer-Policy: ${h['referrer-policy']}`, 'Recommended: Referrer-Policy header'),
    leaks
      ? result('security', 'server-leak', 'warn', `Server version exposed: ${[h['server'], h['x-powered-by']].filter(Boolean).join(' / ')}`)
      : result('security', 'server-leak', 'pass', 'No server version exposed'),
  ];
}
