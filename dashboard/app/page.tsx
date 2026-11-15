import Link from 'next/link';
import { getRecentRuns, getSites } from '@/lib/db';
import { CATEGORIES, CATEGORY_LABEL, type RunRow } from '@/lib/types';
import { AutoRefresh } from '@/components/client';
import { Pill, Score, Sparkline, TopBar, timeAgo } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const [sites, runs] = await Promise.all([getSites(), getRecentRuns()]);
  const bySite = new Map<string, RunRow[]>();
  for (const r of runs) bySite.set(r.site_id, [...(bySite.get(r.site_id) ?? []), r]);
  const anyRunning = runs.some((r) => r.status === 'running');

  const summary = sites.map((s) => {
    const rs = bySite.get(s.id) ?? [];
    const done = rs.filter((r) => r.status === 'passed' || r.status === 'failed');
    const full = done.filter((r) => r.kind === 'full');
    const quick = done.find((r) => r.kind === 'quick');
    return { site: s, latest: full[0], quick, running: rs.find((r) => r.status === 'running'), trend: full.slice(0, 30).reverse().map((r) => r.scores?.overall ?? 0) };
  });
  // A site is "failing" if its newest full or quick check failed.
  const failing = summary.filter((x) => (x.quick && x.latest && x.quick.started_at > x.latest.started_at ? x.quick : x.latest)?.status === 'failed').length;

  return (
    <>
      <TopBar />
      <AutoRefresh active={anyRunning} />
      <main className="container">
        <div className="page-head">
          <div>
            <h1>Sites</h1>
            <p>{sites.length} site{sites.length === 1 ? '' : 's'} · {failing ? <span className="score-bad">{failing} failing</span> : 'all passing'} · quick check every 2 hours · full crawl daily</p>
          </div>
          <Link href="/sites/new" className="btn btn-primary">+ Add site</Link>
        </div>

        {!sites.length && (
          <div className="card card-pad stack" style={{ alignItems: 'flex-start' }}>
            <h2>No sites yet</h2>
            <p className="muted" style={{ margin: 0 }}>Add your first site. The next scheduled run (or “Run full QA”) crawls every page.</p>
            <Link href="/sites/new" className="btn btn-primary">Add a site</Link>
          </div>
        )}

        <div className="grid grid-2">
          {summary.map(({ site, latest, quick, running, trend }) => (
            <Link key={site.id} href={`/sites/${site.name}`} className="card site-card">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2>{site.config.label ?? site.name}</h2>
                  <div className="url">{site.base_url}</div>
                </div>
                <Score value={latest?.scores?.overall} className="big-score" />
              </div>
              <div className="row small">
                {running ? <Pill status="running">Running…</Pill> : latest ? <Pill status={latest.status} /> : <Pill status="muted">No runs yet</Pill>}
                {!site.enabled && <Pill status="muted">Paused</Pill>}
                <span className="muted">{latest ? `${timeAgo(latest.finished_at ?? latest.started_at)} · ${latest.pages.length} pages` : ''}</span>
                <span className="spacer" />
                <Sparkline values={trend} />
              </div>
              {latest?.scores && (
                <div className="cat-grid">
                  {CATEGORIES.filter((c) => (latest.scores?.[c] ?? -1) >= 0).map((c) => (
                    <div className="cat" key={c}>
                      <div className="label">{CATEGORY_LABEL[c]}</div>
                      <Score value={latest.scores?.[c]} />
                    </div>
                  ))}
                </div>
              )}
              {quick && (
                <div className="small muted">
                  Quick check {timeAgo(quick.finished_at ?? quick.started_at)}: <Pill status={quick.status} />
                  {quick.new_issues && quick.new_issues.length > 0 && <span className="score-bad"> · {quick.new_issues.length} new issue{quick.new_issues.length > 1 ? 's' : ''}</span>}
                </div>
              )}
              {latest?.new_issues && latest.new_issues.length > 0 && (
                <div className="small score-bad">▲ {latest.new_issues.length} new issue{latest.new_issues.length > 1 ? 's' : ''} since the previous run</div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
