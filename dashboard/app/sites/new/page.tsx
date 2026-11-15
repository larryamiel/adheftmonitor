import { SiteForm } from '@/components/SiteForm';
import { TopBar } from '@/components/ui';

export default function NewSite() {
  return (
    <>
      <TopBar />
      <main className="container stack">
        <div className="page-head">
          <div>
            <h1>Add a site</h1>
            <p>Only the name and URL are required. Every page is crawled by default.</p>
          </div>
        </div>
        <SiteForm />
      </main>
    </>
  );
}
