import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { CheckResult, PageData, SiteConfig } from './types.js';
import { result } from './util.js';
import { dbConfigured, db } from './db.js';

/** Where baselines/diffs live: local folder, or Supabase Storage bucket "qa" when the DB is configured. */
export interface ImageStore {
  get(key: string): Promise<Buffer | undefined>;
  put(key: string, data: Buffer): Promise<void>;
  remove(keys: string[]): Promise<void>;
  describe(key: string): string;
}

export function localStore(dir = 'screenshots'): ImageStore {
  return {
    async get(key) { try { return await readFile(join(dir, key)); } catch { return undefined; } },
    async put(key, data) { const f = join(dir, key); await mkdir(dirname(f), { recursive: true }); await writeFile(f, data); },
    async remove(keys) { await Promise.all(keys.map((k) => rm(join(dir, k), { force: true }))); },
    describe: (key) => join(dir, key),
  };
}

export function supabaseStore(bucket = 'qa'): ImageStore {
  return {
    async get(key) {
      const { data, error } = await db().storage.from(bucket).download(key);
      return error || !data ? undefined : Buffer.from(await data.arrayBuffer());
    },
    async put(key, data) {
      const { error } = await db().storage.from(bucket).upload(key, data, { contentType: 'image/png', upsert: true });
      if (error) throw new Error(`Upload ${key}: ${error.message}`);
    },
    async remove(keys) { await db().storage.from(bucket).remove(keys); },
    describe: (key) => `storage:${bucket}/${key}`,
  };
}

export const defaultStore = () => (dbConfigured() ? supabaseStore() : localStore());

const MIN_CHANGED_PIXELS = 3000;
const CELL = 32;

/**
 * Finds 32px cells that changed between two shots taken 1.5 s apart (moving content), grows them by one
 * cell, and copies the baseline's pixels into the current image there so they never count as a change.
 * Returns the number of moving cells.
 */
function ignoreMovingContent(prev: PNG, cur: PNG, baseData: Buffer, curData: Buffer, w: number, h: number): number {
  if (prev.width !== cur.width || prev.height !== cur.height) return 0;
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const moving = new Uint8Array(cols * rows);
  const pw = prev.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * pw + x) * 4;
      const d = Math.abs(prev.data[i] - cur.data[i]) + Math.abs(prev.data[i + 1] - cur.data[i + 1]) + Math.abs(prev.data[i + 2] - cur.data[i + 2]);
      if (d > 30) moving[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
    }
  }
  const grown = new Uint8Array(moving);
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!moving[r * cols + c]) continue;
      count++;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) grown[rr * cols + cc] = 1;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grown[r * cols + c]) continue;
      for (let y = r * CELL; y < Math.min(h, (r + 1) * CELL); y++) {
        const start = (y * w + c * CELL) * 4;
        const end = (y * w + Math.min(w, (c + 1) * CELL)) * 4;
        baseData.copy(curData, start, start, end);
      }
    }
  }
  return count;
}

const slug = (path: string) => (path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/[^\w-]+/g, '_')).slice(0, 80);

/**
 * Compares each screenshot against the approved baseline.
 * - No baseline yet → this screenshot becomes the baseline (first run).
 * - `approve` → overwrite baselines with the current screenshots (after an intended redesign).
 * - Changed → save current + a red-highlighted diff image next to it.
 */
export async function visualChecks(site: SiteConfig, p: PageData, store: ImageStore, approve: boolean): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const threshold = site.visual?.threshold ?? 0.5;
  for (const shot of p.screenshots) {
    // Fonts render differently per OS: GitHub (Linux) baselines live in "375", a Windows run in "375-win32",
    // so a local run never compares against (or overwrites) the scheduled runs' baselines.
    const base = `${site.name}/${slug(p.path)}/${shot.width}${process.platform === 'linux' ? '' : `-${process.platform}`}`;
    const id = `diff-${shot.width}`;
    try {
      const prevBuf = approve ? undefined : await store.get(`${base}/baseline.png`);
      if (!prevBuf) {
        await store.put(`${base}/baseline.png`, shot.png);
        await store.remove([`${base}/current.png`, `${base}/diff.png`]);
        out.push(result('visual', id, 'info', `@${shot.width}px baseline ${approve ? 'approved' : 'saved (first run)'}`, p.path));
        continue;
      }
      const a = PNG.sync.read(prevBuf);
      const b = PNG.sync.read(shot.png);
      const w = Math.min(a.width, b.width);
      const h = Math.min(a.height, b.height);
      const crop = (img: PNG) => {
        if (img.width === w && img.height === h) return img.data;
        const outImg = new PNG({ width: w, height: h });
        PNG.bitblt(img, outImg, 0, 0, w, h, 0, 0);
        return outImg.data;
      };
      const baseData = crop(a);
      const curData = crop(b);
      const movingAreas = shot.previous ? ignoreMovingContent(PNG.sync.read(shot.previous), b, baseData, curData, w, h) : 0;
      const diff = new PNG({ width: w, height: h });
      const changed = pixelmatch(baseData, curData, diff.data, w, h, { threshold: 0.1, includeAA: false });
      const pct = (changed / (w * h)) * 100;
      const heightChange = Math.abs(a.height - b.height);
      // % alone misses small-but-real edits (a new headline is < 0.5% of a 1920px full page), so also
      // flag any change larger than ~55×55 px. Anti-aliasing noise is already ignored by pixelmatch.
      const significant = pct > threshold || changed > MIN_CHANGED_PIXELS;
      const movingNote = movingAreas ? `, ${movingAreas} moving area(s) ignored` : '';
      if (!significant && heightChange < 50) {
        await store.remove([`${base}/current.png`, `${base}/diff.png`]); // clear any stale "changed" state
        out.push(result('visual', id, 'pass', `@${shot.width}px matches baseline (${pct.toFixed(2)}% changed${movingNote})`, p.path));
        continue;
      }
      await store.put(`${base}/current.png`, shot.png);
      await store.put(`${base}/diff.png`, PNG.sync.write(diff));
      const why = [
        significant ? `${changed.toLocaleString()} pixels changed (${pct.toFixed(2)}%)` : '',
        heightChange >= 50 ? `page height ${a.height}→${b.height}px` : '',
      ].filter(Boolean).join(', ');
      out.push(result('visual', id, 'warn', `@${shot.width}px looks different from baseline: ${why}`, p.path,
        [`diff: ${store.describe(`${base}/diff.png`)}`, `If intended, approve with: npm run qa -- --site ${site.name} --pages ${p.path} --approve`]));
    } catch (e) {
      out.push(result('visual', id, 'info', `@${shot.width}px comparison failed: ${(e as Error).message}`, p.path));
    }
  }
  return out;
}
