// Session = "<expiry>.<HMAC-SHA256(expiry)>" keyed by DASHBOARD_PASSWORD, so changing the password
// signs everyone out. Uses Web Crypto so it works in middleware (edge) and server actions alike.

export const SESSION_COOKIE = 'am_session';
export const SESSION_DAYS = 14;

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) throw new Error('DASHBOARD_PASSWORD is not set');
  const key = await crypto.subtle.importKey('raw', enc.encode(`am-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSession(): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  return `${exp}.${await hmac(String(exp))}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.DASHBOARD_PASSWORD) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}
