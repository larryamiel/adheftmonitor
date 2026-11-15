import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ResultRow, RunRow, SiteRow } from './types';

let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

const RUN_COLS = 'id,site_id,trigger,kind,partial,status,started_at,finished_at,duration_ms,pages,scores,viewport_scores,counts,new_issues,fixed,error';

export async function getSites(): Promise<SiteRow[]> {
  const { data, error } = await db().from('sites').select('*').order('name');
  if (error) throw new Error(error.message);
  return data as SiteRow[];
}

export async function getSite(name: string): Promise<SiteRow | null> {
  const { data, error } = await db().from('sites').select('*').eq('name', name).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SiteRow | null;
}

/** Recent runs for all sites (overview sparklines + latest status). */
export async function getRecentRuns(days = 14): Promise<RunRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db().from('runs').select(RUN_COLS)
    .gte('started_at', since).order('started_at', { ascending: false }).limit(3000);
  if (error) throw new Error(error.message);
  return data as RunRow[];
}

export async function getSiteRuns(siteId: string, limit = 100): Promise<RunRow[]> {
  const { data, error } = await db().from('runs').select(RUN_COLS)
    .eq('site_id', siteId).order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data as RunRow[];
}

export async function getRun(id: string): Promise<RunRow | null> {
  const { data, error } = await db().from('runs').select(RUN_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as RunRow | null;
}

export async function getRunResults(runId: string): Promise<ResultRow[]> {
  const rows: ResultRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db().from('results').select('*').eq('run_id', runId).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as ResultRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function getSiteById(id: string): Promise<SiteRow | null> {
  const { data } = await db().from('sites').select('*').eq('id', id).maybeSingle();
  return data as SiteRow | null;
}
