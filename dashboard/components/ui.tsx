import Link from 'next/link';
import { logout } from '@/app/actions';
import type { RunRow, Status } from '@/lib/types';

export function scoreClass(n: number | undefined | null) {
  if (n === undefined || n === null || n < 0) return 'score-none';
  return n >= 90 ? 'score-good' : n >= 70 ? 'score-warn' : 'score-bad';
}

export function scoreColor(n: number) {
  return n >= 90 ? 'var(--good)' : n >= 70 ? 'var(--warn)' : 'var(--bad)';
}

export function Score({ value, className = '' }: { value: number | undefined | null; className?: string }) {
  const none = value === undefined || value === null || value < 0;
  return <span className={`score ${scoreClass(value)} ${className}`}>{none ? '–' : value}</span>;
}

const STATUS_LABEL: Record<string, string> = {
  pass: 'Pass', warn: 'Warn', fail: 'Fail', info: 'Info',
  passed: 'Passed', failed: 'Failed', running: 'Running', error: 'Error',
};

export function Pill({ status, children }: { status: Status | RunRow['status'] | 'muted'; children?: React.ReactNode }) {
  return <span className={`pill pill-${status}`}>{children ?? STATUS_LABEL[status] ?? status}</span>;
}

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand"><span className="brand-dot" />Adheft Monitor</Link>
        <nav>
          <Link href="/">Sites</Link>
          <Link href="/sites/new">Add site</Link>
          <form action={logout}><button className="btn btn-sm" type="submit">Log out</button></form>
        </nav>
      </div>
    </header>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (!ms) return '–';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Tiny inline SVG trend line (oldest → newest). */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="faint small">not enough runs yet</span>;
  const min = Math.min(...values, 50);
  const max = 100;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score trend, latest ${last}`}>
      <path d={d} fill="none" stroke={scoreColor(last)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.8" fill={scoreColor(last)} />
    </svg>
  );
}

/** Larger trend chart with gridlines, for the site page. */
export function TrendChart({ runs }: { runs: { at: string; score: number }[] }) {
  const W = 720, H = 180, P = { l: 34, r: 12, t: 10, b: 24 };
  if (runs.length < 2) return <p className="muted">The trend appears after a couple of runs.</p>;
  const min = Math.max(0, Math.min(...runs.map((r) => r.score)) - 10);
  const x = (i: number) => P.l + (i / (runs.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / (100 - min || 1)) * (H - P.t - P.b);
  const d = runs.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ');
  const ticks = [min, Math.round((min + 100) / 2), 100];
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Overall score over time" style={{ maxHeight: 220 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">{t}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {runs.map((r, i) => (
        <circle key={i} cx={x(i)} cy={y(r.score)} r="2.5" fill={scoreColor(r.score)}>
          <title>{`${new Date(r.at).toLocaleString()}: ${r.score}`}</title>
        </circle>
      ))}
      <text x={P.l} y={H - 6} fontSize="11" fill="var(--faint)">{fmt(runs[0].at)}</text>
      <text x={W - P.r} y={H - 6} fontSize="11" fill="var(--faint)" textAnchor="end">{fmt(runs[runs.length - 1].at)}</text>
    </svg>
  );
}

export function ViewportBars({ scores }: { scores: Record<string, number> | null | undefined }) {
  const entries = Object.entries(scores ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entries.length) return <p className="muted small">No responsive data yet.</p>;
  return (
    <div className="vp-bars">
      {entries.map(([w, s]) => (
        <div className="vp-bar" key={w} title={`${w}px: ${s}/100`}>
          <span className={`s ${scoreClass(s)}`}>{s}</span>
          <div className="bar-wrap"><div className="bar" style={{ height: `${Math.max(4, s)}%`, background: scoreColor(s) }} /></div>
          <span className="w">{w}</span>
        </div>
      ))}
    </div>
  );
}
