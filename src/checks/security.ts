import type { CheckResult, PageData } from '../types.js';
import { result } from '../util.js';

export function securityChecks(home: PageData): CheckResult[] {
  const h = home.headers;
  const add = (id: string, ok: boolean, okMsg: string, badMsg: string, sev: 'warn' | 'fail' = 'warn') =>
    result('security', id, ok ? 'pass' : sev, ok ? okMsg : badMsg);
  const csp = h['content-security-policy'] ?? '';
  return [
    add('hsts', !!h['strict-transport-security'], 'HSTS enabled', 'Missing Strict-Transport-Security header'),
    add('nosniff', /nosniff/i.test(h['x-content-type-options'] ?? ''), 'X-Content-Type-Options: nosniff', 'Missing X-Content-Type-Options: nosniff'),
    add('clickjacking', !!h['x-frame-options'] || /frame-ancestors/i.test(csp),
      'Clickjacking protection set', 'No X-Frame-Options or CSP frame-ancestors (site can be iframed)'),
    add('referrer-policy', !!h['referrer-policy'], `Referrer-Policy: ${h['referrer-policy']}`, 'Missing Referrer-Policy header'),
    result('security', 'server-leak', /\d/.test(h['x-powered-by'] ?? '') || /\/\d/.test(h['server'] ?? '') ? 'warn' : 'pass',
      h['x-powered-by'] || /\/\d/.test(h['server'] ?? '') ? `Server version exposed: ${[h['server'], h['x-powered-by']].filter(Boolean).join(' / ')}` : 'No server version exposed'),
  ];
}
