import { CATEGORIES, CATEGORY_LABEL, type ResultRow, type Scores, type Status } from '@/lib/types';
import { Pill, Score } from './ui';

const RANK: Record<Status, number> = { fail: 0, warn: 1, info: 2, pass: 3 };

interface Group { status: Status; message: string; pages: string[]; details: string[] | null; siteLevel: boolean }

/**
 * Collapse repeated issues across pages. Messages that differ only in numbers
 * ("TTFB 2743 ms" vs "TTFB 2506 ms") become one row with each page's value listed.
 */
function group(rows: ResultRow[]): Group[] {
  const map = new Map<string, { rows: ResultRow[] }>();
  for (const r of rows) {
    const shape = r.message.replace(/\d[\d.,]*/g, '#');
    const k = r.page ? `${r.check_id}|${r.status}|${shape}` : `${r.check_id}|${r.status}|${r.message}|${r.id}`;
    map.set(k, { rows: [...(map.get(k)?.rows ?? []), r] });
  }
  const groups: Group[] = [...map.values()].map(({ rows: rs }) => {
    const first = rs[0];
    const pages = rs.map((r) => r.page).filter((p): p is string => !!p);
    if (rs.length === 1) return { status: first.status, message: first.message, pages, details: first.details, siteLevel: !first.page };
    const sameMsg = rs.every((r) => r.message === first.message);
    const sameDetails = rs.every((r) => (r.details ?? []).join('\n') === (first.details ?? []).join('\n'));
    return {
      status: first.status,
      message: sameMsg ? first.message : first.message.replace(/\d[\d.,]*/g, '…'),
      pages,
      details: sameMsg && sameDetails ? first.details : rs.map((r) => `${r.page}: ${r.message}${!sameDetails && r.details?.length ? ` (${r.details.slice(0, 3).join('; ')})` : ''}`),
      siteLevel: false,
    };
  });
  return groups.sort((a, b) => RANK[a.status] - RANK[b.status] || b.pages.length - a.pages.length);
}

export function Results({ rows, scores }: { rows: ResultRow[]; scores: Scores | null }) {
  const cats = CATEGORIES.filter((c) => rows.some((r) => r.category === c) || (scores?.[c] ?? -1) >= 0);
  if (!cats.length) return <p className="card-pad muted">No issues stored for this run.</p>;
  return (
    <div>
      {cats.map((c) => {
        const rs = rows.filter((r) => r.category === c);
        const fails = rs.filter((r) => r.status === 'fail').length;
        const warns = rs.filter((r) => r.status === 'warn').length;
        const groups = group(rs);
        return (
          <details key={c} className="cat-section" open={fails > 0}>
            <summary>
              <Score value={scores?.[c]} />
              <h3 style={{ minWidth: 110 }}>{CATEGORY_LABEL[c]}</h3>
              {fails > 0 && <Pill status="fail">{fails} fail</Pill>}
              {warns > 0 && <Pill status="warn">{warns} warn</Pill>}
              {!fails && !warns && <Pill status="pass">All good</Pill>}
            </summary>
            {groups.map((g, i) => (
              <div className="result" key={i}>
                <div><Pill status={g.status} /></div>
                <div>
                  <div className="msg">{g.message}</div>
                  {g.pages.length > 0 && (
                    <div className="where">
                      {g.pages.length === 1 ? <code>{g.pages[0]}</code> : <>{g.pages.length} pages: <code>{g.pages.slice(0, 8).join(', ')}{g.pages.length > 8 ? ', …' : ''}</code></>}
                    </div>
                  )}
                  {g.details && g.details.length > 0 && (
                    <details open={g.status === 'fail' && g.details.length <= 6}>
                      <summary>{g.details.length} detail{g.details.length > 1 ? 's' : ''}</summary>
                      <ul>{g.details.slice(0, 60).map((d, j) => <li key={j}>{d}</li>)}</ul>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </details>
        );
      })}
    </div>
  );
}
