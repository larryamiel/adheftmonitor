import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRunResults, getSite, getSiteRuns } from '@/lib/db';
import { githubConfigured } from '@/lib/github';
import { toggleSite } from '@/app/actions';
import { AutoRefresh, RunControls } from '@/components/client';
import { Results } from '@/components/Results';
import { Pill, Score, TopBar, TrendChart, ViewportBars, duration, timeAgo } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { name } = await params;
  const { created } = await searchParams;
  const site = await getSite(name);
  if (!site) notFound();
  const runs = await getSiteRuns(site.id);
  const finished = runs.filter((r) => r.status === 'passed' || r.status === 'failed');
  const latest = finished.find((r) => !r.partial);
  const running = runs.find((r) => r.status === 'running');
  const results = latest ? await getRunResults(latest.id) : [];
  const trend = finished.filter((r) => !r.partial).slice(0, 60).reverse()
    .map((r) => ({ at: r.started_at, score: r.scores?.overall ?? 0 }));

  return (
    <>
      <TopBar />
      <AutoRefresh active={!!running} />
      <main className="container stack">
        <div className="page-head">
          <div>
            <div className="row">
              <h1>{site.name}</h1>
              {!site.enabled && <Pill status="muted">Paused</Pill>}
              {running && <Pill status="running">Running since {timeAgo(running.started_at)}</Pill>}
            </div>
            <p><a href={site.base_url} target="_blank" rel="noreferrer">{site.base_url} ↗</a></p>
            <div className="row" style={{ marginTop: 10 }}>
              <Link href={`/sites/${site.name}/edit`} className="btn btn-sm">Settings</Link>
              <Link href={`/sites/${site.name}/screenshots`} className="btn btn-sm">Screenshots</Link>
              <form action={toggleSite}>
                <input type="hidden" name="name" value={site.name} />
                <input type="hidden" name="enabled" value={String(!site.enabled)} />
                <button className="btn btn-sm" type="submit">{site.enabled ? 'Pause schedule' : 'Resume schedule'}</button>
              </form>
            </div>
          </div>
          <RunControls site={site.name} enabled={site.enabled} githubReady={githubConfigured()} />
        </div>

        {created && <div className="alert alert-ok">Site added. It will be checked on the next scheduled run, or click “Run full QA” now.</div>}

        {!latest ? (
          <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>No completed full run yet.</p></div>
        ) : (
          <>
            <div className="grid grid-2">
              <div className="card card-pad stack">
                <div className="row">
                  <div>
                    <div className="muted small">Overall score · last full run {timeAgo(latest.finished_at)}</div>
                    <Score value={latest.scores?.overall} className="big-score" />
                  </div>
                  <span className="spacer" />
                  <Pill status={latest.status} />
                </div>
                <div className="row small muted">
                  <span>{latest.pages.length} pages</span>·
                  <span>{latest.counts?.fail ?? 0} failures</span>·
                  <span>{latest.counts?.warn ?? 0} warnings</span>·
                  <span>{duration(latest.duration_ms)}</span>
                </div>
                <TrendChart runs={trend} />
              </div>
              <div className="card card-pad stack">
                <div>
                  <h2>Responsive score by screen width</h2>
                  <p className="muted small" style={{ margin: '2px 0 0' }}>Average across all {latest.pages.length} pages: overflow, tap targets, text size, clipping, overlays.</p>
                </div>
                <ViewportBars scores={latest.viewport_scores} />
                {(latest.new_issues?.length || latest.fixed?.length) ? (
                  <div className="stack" style={{ gap: 6 }}>
                    <h3>Since the previous run</h3>
                    {latest.new_issues?.slice(0, 6).map((x, i) => (
                      <div key={`n${i}`} className="small"><Pill status="fail">New</Pill> {x.page && <code>{x.page}</code>} {x.message}</div>
                    ))}
                    {latest.fixed?.slice(0, 4).map((x, i) => (
                      <div key={`f${i}`} className="small"><Pill status="pass">Fixed</Pill> {x.page && <code>{x.page}</code>} {x.message}</div>
                    ))}
                    <Link href={`/runs/${latest.id}`} className="small">See full diff →</Link>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Checklist: latest full run</h2>
                <Link href={`/runs/${latest.id}`} className="small">Run details →</Link>
              </div>
              <Results rows={results} scores={latest.scores} />
            </div>
          </>
        )}

        <div className="card">
          <div className="card-head"><h2>Run history</h2></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Started</th><th>Status</th><th>Type</th><th>Pages</th><th>Score</th><th>Duration</th><th>Changes</th></tr>
              </thead>
              <tbody>
                {runs.slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/runs/${r.id}`}>{new Date(r.started_at).toLocaleString()}</Link></td>
                    <td><Pill status={r.status} /></td>
                    <td className="muted">{r.partial ? 'manual check' : r.trigger}</td>
                    <td>{r.pages.length || '–'}</td>
                    <td><Score value={r.scores?.overall} /></td>
                    <td className="muted">{duration(r.duration_ms)}</td>
                    <td className="small">
                      {r.new_issues?.length ? <span className="score-bad">+{r.new_issues.length} new </span> : null}
                      {r.fixed?.length ? <span className="score-good">{r.fixed.length} fixed</span> : null}
                      {r.error && <span className="score-bad">{r.error}</span>}
                    </td>
                  </tr>
                ))}
                {!runs.length && <tr><td colSpan={7} className="muted">No runs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
