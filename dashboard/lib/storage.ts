import 'server-only';
import { db } from './db';

const BUCKET = 'qa';

export interface Shot {
  page: string;          // slug, e.g. "home", "pricing"
  width: number;
  baseline?: string;     // signed URLs
  current?: string;
  diff?: string;
  changed: boolean;
}

async function list(prefix: string): Promise<string[]> {
  const { data, error } = await db().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) return [];
  return (data ?? []).map((f) => f.name);
}

/** Layout in storage: <site>/<page-slug>/<width>/{baseline,current,diff}.png */
export async function listShots(site: string): Promise<Shot[]> {
  const pages = await list(site);
  const entries = await Promise.all(pages.map(async (page) => {
    const widths = await list(`${site}/${page}`);
    return Promise.all(widths.map(async (w) => ({ page, width: Number(w), files: await list(`${site}/${page}/${w}`) })));
  }));
  const flat = entries.flat().filter((e) => Number.isFinite(e.width) && e.files.length);
  const paths = flat.flatMap((e) => e.files.map((f) => `${site}/${e.page}/${e.width}/${f}`));
  const signed = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await db().storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), 3600);
    for (const s of data ?? []) if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
  }
  const url = (e: (typeof flat)[number], f: string) => signed.get(`${site}/${e.page}/${e.width}/${f}`);
  return flat
    .map((e) => ({
      page: e.page,
      width: e.width,
      baseline: url(e, 'baseline.png'),
      current: url(e, 'current.png'),
      diff: url(e, 'diff.png'),
      changed: e.files.includes('diff.png'),
    }))
    .sort((a, b) => (a.page === 'home' ? -1 : b.page === 'home' ? 1 : a.page.localeCompare(b.page)) || a.width - b.width);
}

/** Accept the current screenshot as the new baseline and clear the diff. */
export async function approveShot(site: string, page: string, width: number): Promise<void> {
  const base = `${site}/${page}/${width}`;
  const { data, error } = await db().storage.from(BUCKET).download(`${base}/current.png`);
  if (error || !data) throw new Error(`No current screenshot for ${base}`);
  const up = await db().storage.from(BUCKET).upload(`${base}/baseline.png`, data, { contentType: 'image/png', upsert: true });
  if (up.error) throw new Error(up.error.message);
  await db().storage.from(BUCKET).remove([`${base}/current.png`, `${base}/diff.png`]);
}

/** Remove all screenshots of a site (when the site is deleted). */
export async function deleteSiteShots(site: string): Promise<void> {
  const pages = await list(site);
  const paths: string[] = [];
  for (const page of pages) {
    for (const w of await list(`${site}/${page}`)) {
      for (const f of await list(`${site}/${page}/${w}`)) paths.push(`${site}/${page}/${w}/${f}`);
    }
  }
  for (let i = 0; i < paths.length; i += 100) await db().storage.from(BUCKET).remove(paths.slice(i, i + 100));
}
