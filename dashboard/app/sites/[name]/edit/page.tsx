import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/db';
import { deleteSite } from '@/app/actions';
import { SiteForm } from '@/components/SiteForm';
import { Submit } from '@/components/client';
import { TopBar } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function EditSite({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { name } = await params;
  const { error } = await searchParams;
  const site = await getSite(name);
  if (!site) notFound();
  return (
    <>
      <TopBar />
      <main className="container stack">
        <div className="page-head">
          <div>
            <p className="small" style={{ margin: 0 }}><Link href={`/sites/${site.name}`}>← {site.name}</Link></p>
            <h1>Settings</h1>
          </div>
        </div>
        <SiteForm site={site} />
        <fieldset style={{ borderColor: 'var(--bad)' }}>
          <legend style={{ color: 'var(--bad)' }}>Delete site</legend>
          <form action={deleteSite} className="stack" style={{ gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>Permanently deletes this site, its whole run history and its screenshots. Type <code>{site.name}</code> to confirm.</p>
            <input type="hidden" name="name" value={site.name} />
            <input type="text" name="confirm" autoComplete="off" style={{ maxWidth: 320 }} />
            {error === 'confirm' && <div className="alert alert-error">The name didn’t match.</div>}
            <div><Submit className="btn btn-danger" pendingText="Deleting…">Delete site</Submit></div>
          </form>
        </fieldset>
      </main>
    </>
  );
}
