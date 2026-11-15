import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRun, getRunResults, getSiteById } from '@/lib/db';
import { AutoRefresh } from '@/components/client';
import { Results } from '@/components/Results';
import { Pill, Score, TopBar, ViewportBars, duration } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const run = await getRun(id);
  if (!run) notFound();
  const [site, results] = await Promise.all([getSiteById(run.site_id), getRunResults(run.id)]);

  return (
    <>
      <TopBar />
      <AutoRefresh active={run.status === 'running'} />
      <main className="container stack">
        <div className="page-head">
          <div>
            <p className="small" style={{ margin: 0 }}><Link href={`/sites/${site?.name}`}>← {site?.config.label ?? site?.name}</Link></p>
            <div className="row" style={{ marginTop: 4 }}>
              <h1>{run.kind === 'manual' ? 'Manual check' : run.kind === 'quick' ? 'Quick check (key pages)' : 'Full crawl'}</h1>
              <Pill status={run.status} />
            </div>
            <p>{new Date(run.started_at).toLocaleString()} · {run.trigger} · {run.pages.length} pages · {duration(run.duration_ms)}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted small">Overall</div>
            <Score value={run.scores?.overall} className="big-score" />
          </div>
        </div>

        {run.error && <div className="alert alert-error">Run error: {run.error}</div>}
        {run.status === 'running' && <div className="alert alert-info">This run is in progress; the page refreshes itself.</div>}

        {(run.new_issues?.length || run.fixed?.length) ? (
          <div className="card">
            <div className="card-head"><h2>{run.kind === 'manual' ? 'Compared with the last full crawl' : run.kind === 'quick' ? 'Changes since the previous quick check' : 'Changes since the previous full crawl'}</h2></div>
            <div className="card-pad stack" style={{ gap: 6 }}>
              {run.new_issues?.map((x, i) => (
                <div key={`n${i}`}><Pill status="fail">New</Pill> <Pill status={x.status} /> {x.page && <code>{x.page}</code>} {x.message}</div>
              ))}
              {run.fixed?.map((x, i) => (
                <div key={`f${i}`}><Pill status="pass">Fixed</Pill> {x.page && <code>{x.page}</code>} {x.message}</div>
              ))}
            </div>
          </div>
        ) : null}

        {run.viewport_scores && Object.keys(run.viewport_scores).length > 0 && (
          <div className="card card-pad stack">
            <h2>Responsive score by screen width</h2>
            <ViewportBars scores={run.viewport_scores} />
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h2>Checklist</h2>
            <span className="small muted">{run.counts ? `${run.counts.pass} passed · ${run.counts.warn} warnings · ${run.counts.fail} failures` : ''}</span>
          </div>
          <Results rows={results} scores={run.scores} />
        </div>

        {run.pages.length > 0 && (
          <details className="card card-pad">
            <summary><strong>Pages checked ({run.pages.length})</strong></summary>
            <ul className="small mono" style={{ columns: '280px', marginBottom: 0 }}>
              {run.pages.map((p) => <li key={p}><a href={(site?.base_url ?? '') + p} target="_blank" rel="noreferrer">{p}</a></li>)}
            </ul>
          </details>
        )}
      </main>
    </>
  );
}
