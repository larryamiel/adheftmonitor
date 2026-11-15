import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CheckResult, SiteConfig, SiteReport, Status } from './types.js';
import type { Diff } from './report.js';

let client: SupabaseClient | undefined;

export const dbConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export function db(): SupabaseClient {
  if (!client) {
    if (!dbConfigured()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)');
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return client;
}

interface SiteRow { id: string; name: string; base_url: string; config: Partial<SiteConfig>; enabled: boolean }

const toSite = (r: SiteRow): SiteConfig & { id: string } =>
  ({ ...r.config, id: r.id, name: r.name, baseUrl: r.base_url.replace(/\/+$/, '') });

export async function loadSitesFromDb(includeDisabled = false): Promise<(SiteConfig & { id: string })[]> {
  let q = db().from('sites').select('id,name,base_url,config,enabled').order('name');
  if (!includeDisabled) q = q.eq('enabled', true);
  const { data, error } = await q;
  if (error) throw new Error(`Loading sites: ${error.message}`);
  return (data as SiteRow[]).map(toSite);
}

export async function upsertSite(site: SiteConfig): Promise<void> {
  const { name, baseUrl, ...config } = site;
  const { error } = await db().from('sites').upsert(
    { name, base_url: baseUrl, config, updated_at: new Date().toISOString() },
    { onConflict: 'name' },
  );
  if (error) throw new Error(`Saving site ${name}: ${error.message}`);
}

export async function startRun(siteId: string, trigger: string, partial: boolean): Promise<string> {
  const { data, error } = await db().from('runs').insert({ site_id: siteId, trigger, partial }).select('id').single();
  if (error) throw new Error(`Creating run: ${error.message}`);
  return data.id;
}

/** Previous finished run, rebuilt as a SiteReport (non-pass results only) for diffing. */
export async function previousReport(siteId: string, excludeRunId: string): Promise<SiteReport | undefined> {
  const { data: run } = await db().from('runs')
    .select('id,started_at,duration_ms,pages,scores')
    .eq('site_id', siteId).eq('partial', false).in('status', ['passed', 'failed']).neq('id', excludeRunId)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (!run) return undefined;
  const results: CheckResult[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('results')
      .select('check_id,category,status,message,page,details').eq('run_id', run.id).order('id').range(from, from + 999);
    if (error || !data?.length) break;
    results.push(...data.map((r) => ({ id: r.check_id, category: r.category, status: r.status, message: r.message, page: r.page ?? undefined, details: r.details ?? undefined })));
    if (data.length < 1000) break;
  }
  return { site: '', baseUrl: '', startedAt: run.started_at, durationMs: run.duration_ms ?? 0, pages: run.pages ?? [], results, scores: run.scores ?? {} };
}

const slim = (r: CheckResult) => ({ id: r.id, page: r.page, status: r.status, message: r.message });

export async function finishRun(runId: string, report: SiteReport, diff?: Diff): Promise<void> {
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  report.results.forEach((r) => counts[r.status]++);

  const rows = report.results.filter((r) => r.status !== 'pass').map((r) => ({
    run_id: runId, check_id: r.id, category: r.category, status: r.status, message: r.message,
    page: r.page ?? null, details: r.details ?? null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from('results').insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Saving results: ${error.message}`);
  }

  const { error } = await db().from('runs').update({
    status: counts.fail ? 'failed' : 'passed',
    finished_at: new Date().toISOString(),
    duration_ms: report.durationMs,
    pages: report.pages,
    scores: report.scores,
    viewport_scores: report.viewportScores ?? null,
    counts,
    new_issues: diff?.newIssues.map(slim) ?? [],
    fixed: diff?.fixed.map(slim) ?? [],
  }).eq('id', runId);
  if (error) throw new Error(`Finishing run: ${error.message}`);
  await db().rpc('prune_old_results', { keep_days: 30 });
}

export async function failRun(runId: string, message: string): Promise<void> {
  await db().from('runs').update({ status: 'error', error: message, finished_at: new Date().toISOString() }).eq('id', runId);
}
