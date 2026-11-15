'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SESSION_COOKIE, SESSION_DAYS, createSession, safeEqual, verifySession } from '@/lib/auth';
import { db } from '@/lib/db';
import { dispatchQa } from '@/lib/github';
import { parseSiteForm } from '@/lib/siteForm';
import { approveShot, deleteSiteShots } from '@/lib/storage';

export type ActionState = { error?: string; ok?: string };

/** Defense in depth: middleware already blocks unauthenticated requests. */
async function requireAuth() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) redirect('/login');
}

export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return { error: 'DASHBOARD_PASSWORD is not configured on the server.' };
  if (!safeEqual(String(form.get('password') ?? ''), expected)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return { error: 'Wrong password.' };
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect('/');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function saveSite(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAuth();
  let parsed;
  try {
    parsed = parseSiteForm(form);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const isNew = form.get('mode') === 'create';
  if (isNew) {
    const { error } = await db().from('sites').insert({
      name: parsed.name, base_url: parsed.baseUrl, config: parsed.config, enabled: parsed.enabled,
    });
    if (error) return { error: error.code === '23505' ? `A site named "${parsed.name}" already exists.` : error.message };
  } else {
    const { error } = await db().from('sites').update({
      base_url: parsed.baseUrl, config: parsed.config, enabled: parsed.enabled, updated_at: new Date().toISOString(),
    }).eq('name', parsed.name);
    if (error) return { error: error.message };
  }
  revalidatePath('/');
  redirect(`/sites/${parsed.name}${isNew ? '?created=1' : ''}`);
}

export async function deleteSite(form: FormData) {
  await requireAuth();
  const name = String(form.get('name'));
  if (form.get('confirm') !== name) redirect(`/sites/${name}/edit?error=confirm`);
  await deleteSiteShots(name);
  const { error } = await db().from('sites').delete().eq('name', name);
  if (error) throw new Error(error.message);
  revalidatePath('/');
  redirect('/');
}

export async function toggleSite(form: FormData) {
  await requireAuth();
  const name = String(form.get('name'));
  await db().from('sites').update({ enabled: form.get('enabled') === 'true' }).eq('name', name);
  revalidatePath('/');
  revalidatePath(`/sites/${name}`);
}

export async function runNow(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAuth();
  const site = String(form.get('site'));
  const pages = String(form.get('pages') ?? '')
    .split(/[\s,]+/).map((p) => p.trim()).filter(Boolean)
    .map((p) => { try { return new URL(p).pathname; } catch { return p.startsWith('/') ? p : `/${p}`; } })
    .join(',');
  if (pages && !/^[\w\-./,%~]+$/.test(pages)) return { error: 'Pages contain unsupported characters.' };
  try {
    await dispatchQa({ site, pages, links: form.get('links') !== 'off' });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ok: pages ? `Manual check queued for ${pages}.` : 'Full QA run queued.' };
}

export async function approve(form: FormData) {
  await requireAuth();
  const site = String(form.get('site'));
  const items = String(form.get('items') ?? '').split(';').filter(Boolean); // "page:width;page:width"
  for (const it of items) {
    const i = it.lastIndexOf(':');
    await approveShot(site, it.slice(0, i), Number(it.slice(i + 1)));
  }
  revalidatePath(`/sites/${site}/screenshots`);
}
