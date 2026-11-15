'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { login, runNow, type ActionState } from '@/app/actions';

export function Submit({ children, className = 'btn btn-primary', pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? pendingText ?? 'Working…' : children}</button>;
}

export function LoginForm() {
  const [state, action] = useActionState<ActionState, FormData>(login, {});
  return (
    <form action={action} className="stack">
      <label className="field">
        Password
        <input type="password" name="password" autoFocus required autoComplete="current-password" />
      </label>
      {state.error && <div className="alert alert-error">{state.error}</div>}
      <Submit pendingText="Checking…">Sign in</Submit>
    </form>
  );
}

/** Refreshes server data every 10 s while a run is in progress or was just queued. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [queuedUntil, setQueuedUntil] = useState(0);
  useEffect(() => {
    const onQueued = () => setQueuedUntil(Date.now() + 4 * 60_000);
    window.addEventListener('qa-queued', onQueued);
    return () => window.removeEventListener('qa-queued', onQueued);
  }, []);
  useEffect(() => {
    if (!active && Date.now() > queuedUntil) return;
    const t = setInterval(() => {
      if (active || Date.now() < queuedUntil) router.refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [active, queuedUntil, router]);
  return null;
}

export function RunControls({ site, enabled, githubReady }: { site: string; enabled: boolean; githubReady: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(runNow, {});
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (state.ok) window.dispatchEvent(new Event('qa-queued'));
  }, [state]);
  if (!githubReady) {
    return <span className="small muted">Set GITHUB_TOKEN + GITHUB_REPO to run QA from here.</span>;
  }
  return (
    <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
      <div className="row">
        <form action={action}>
          <input type="hidden" name="site" value={site} />
          <Submit pendingText="Queuing…">▶ Run full QA</Submit>
        </form>
        <button className="btn" type="button" onClick={() => setManual((m) => !m)}>Manual check…</button>
      </div>
      {manual && (
        <form action={action} className="card card-pad stack" style={{ width: 'min(420px, 100%)', gap: 10 }}>
          <input type="hidden" name="site" value={site} />
          <label className="field">
            Pages you changed
            <span className="hint">Paths or full URLs, one per line. Checks only these pages, including screenshots.</span>
            <textarea name="pages" placeholder={'/\n/contact\n/services/roofing'} required />
          </label>
          <label className="check"><input type="checkbox" name="links" value="off" /> Skip link checking (faster)</label>
          <Submit pendingText="Queuing…">Run manual check</Submit>
        </form>
      )}
      {!enabled && <span className="small muted">Site is paused; manual runs still work.</span>}
      {state.error && <div className="alert alert-error small">{state.error}</div>}
      {state.ok && <div className="alert alert-ok small">{state.ok} GitHub takes about 1–2 minutes to start; this page refreshes itself.</div>}
    </div>
  );
}
