import type { Category, CheckResult, Status } from './types.js';

export const UA = 'Mozilla/5.0 (compatible; AdheftMonitor/1.0)';

export function result(
  category: Category,
  id: string,
  status: Status,
  message: string,
  page?: string,
  details?: string[],
): CheckResult {
  return { id: `${category}.${id}`, category, status, message, page, details: details?.length ? details : undefined };
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: { 'user-agent': UA, ...(rest.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Follow redirects manually and return the chain of [url, status]. */
export async function redirectChain(url: string, max = 10): Promise<{ url: string; status: number }[]> {
  const chain: { url: string; status: number }[] = [];
  let current = url;
  for (let i = 0; i < max; i++) {
    const res = await fetchWithTimeout(current, { redirect: 'manual' });
    chain.push({ url: current, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).href;
    } else break;
  }
  return chain;
}

export const digits = (s: string) => s.replace(/\D/g, '');

export const truncate = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
