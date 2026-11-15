'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container">
      <div className="card card-pad stack" style={{ maxWidth: 640 }}>
        <h1>Something went wrong</h1>
        <p className="muted" style={{ margin: 0 }}>
          Usually this means the database can’t be reached: check <code>SUPABASE_URL</code> and{' '}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> in the Vercel environment variables, and that{' '}
          <code>supabase/schema.sql</code> has been run.
        </p>
        {error.digest && <p className="faint small" style={{ margin: 0 }}>Error reference: {error.digest} (details in Vercel logs)</p>}
        <div><button className="btn btn-primary" onClick={reset}>Try again</button></div>
      </div>
    </main>
  );
}
