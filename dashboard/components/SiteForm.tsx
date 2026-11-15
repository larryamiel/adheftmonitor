'use client';

import { useActionState } from 'react';
import { saveSite, type ActionState } from '@/app/actions';
import type { SiteConfig, SiteRow } from '@/lib/types';
import { Submit } from './client';

const j = (a?: string[]) => (a ?? []).join('\n');

export function SiteForm({ site }: { site?: SiteRow }) {
  const [state, action] = useActionState<ActionState, FormData>(saveSite, {});
  const c: SiteConfig = site?.config ?? {};
  const t = c.tracking ?? {};
  const callrail = t.callrail === true ? 'on' : t.callrail ? 'on' : 'off';
  const callrailId = typeof t.callrail === 'object' ? t.callrail.companyId ?? '' : '';

  return (
    <form action={action} className="stack">
      <input type="hidden" name="mode" value={site ? 'update' : 'create'} />

      <fieldset>
        <legend>Site</legend>
        <div className="form-grid">
          <label className="field">
            Display name
            <span className="hint">Shown in the dashboard, e.g. “VIP Animal Hospital / Fullerton”</span>
            <input type="text" name="label" defaultValue={c.label} placeholder="Acme Plumbing" />
          </label>
          <label className="field">
            Short name
            <span className="hint">Lowercase, dashes. Used in URLs and the CLI. Can’t be changed later.</span>
            <input type="text" name="name" defaultValue={site?.name} readOnly={!!site} required pattern="[a-z0-9][a-z0-9\-]*" placeholder="acme-plumbing" />
          </label>
          <label className="field">
            Website URL
            <span className="hint">The canonical address, e.g. https://www.acme.com</span>
            <input type="url" name="baseUrl" defaultValue={site?.base_url} required placeholder="https://www.example.com" />
          </label>
        </div>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" name="enabled" defaultChecked={site?.enabled ?? true} /> Monitor on schedule (every 2 hours)
        </label>
      </fieldset>

      <fieldset>
        <legend>Tracking codes</legend>
        {c.trackingAdoptedAt ? (
          <div className="alert alert-info small" style={{ marginBottom: 12 }}>
            These IDs were <strong>auto-detected</strong> on {new Date(c.trackingAdoptedAt).toLocaleDateString()} from the tags found on most pages.
            Review them and save to confirm.
          </div>
        ) : null}
        <p className="muted small" style={{ marginTop: 0 }}>Leave empty and the first run saves the tags it finds on most pages. Once set, a missing <em>or wrong</em> ID fails.</p>
        <div className="form-grid">
          <label className="field">GTM container IDs<input type="text" name="gtm" defaultValue={(t.gtm ?? []).join(', ')} placeholder="GTM-ABC1234" /></label>
          <label className="field">GA4 measurement IDs<input type="text" name="ga4" defaultValue={(t.ga4 ?? []).join(', ')} placeholder="G-XXXXXXXXXX" /></label>
          <label className="field">Meta Pixel IDs<input type="text" name="metaPixel" defaultValue={(t.metaPixel ?? []).join(', ')} placeholder="1234567890123456" /></label>
          <label className="field">
            CallRail
            <select name="callrail" defaultValue={callrail}>
              <option value="off">Not used</option>
              <option value="on">Required</option>
            </select>
          </label>
          <label className="field">CallRail company ID <span className="hint">Optional: from the swap.js URL</span><input type="text" name="callrailId" defaultValue={callrailId} placeholder="123456789" /></label>
          <label className="field">Cookie banner “Accept” selector <span className="hint">Clicked before checking tags</span><input type="text" name="consentSelector" defaultValue={c.consentSelector} placeholder="#onetrust-accept-btn-handler" /></label>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <label className="field">
            Other tags
            <span className="hint">One per line: <code>Name | regex matching a request URL</code></span>
            <textarea name="customTags" defaultValue={(t.custom ?? []).map((x) => `${x.name} | ${x.pattern}`).join('\n')} placeholder={'LinkedIn Insight | snap\\.licdn\\.com\nTikTok | analytics\\.tiktok\\.com'} />
          </label>
          <label className="field">Pages without tracking <span className="hint">One path per line</span><textarea name="trackingSkip" defaultValue={j(t.skipPages)} /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Pages &amp; crawling</legend>
        <div className="form-grid">
          <label className="field">
            Key pages
            <span className="hint">Get screenshot comparison. Default: home page.</span>
            <textarea name="keyPages" defaultValue={j(c.keyPages)} placeholder={'/\n/contact\n/services'} />
          </label>
          <label className="field">
            Crawl exclusions
            <span className="hint">Regex per line, matched against the path</span>
            <textarea name="exclude" defaultValue={j(c.crawl?.exclude)} placeholder={'^/wp-admin\n^/cart\n^/tag/'} />
          </label>
          <label className="field">Allowed noindex pages <span className="hint">One path per line</span><textarea name="allowNoindex" defaultValue={j(c.allowNoindex)} placeholder="/thank-you" /></label>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <label className="field">Max pages <span className="hint">Empty = all pages</span><input type="number" name="maxPages" min={1} defaultValue={c.crawl?.maxPages} /></label>
          <label className="field">Extra pages to always include <span className="hint">If not linked or in sitemap</span><input type="text" name="pages" defaultValue={(c.pages ?? []).join(', ')} /></label>
        </div>
        <label className="check" style={{ marginTop: 12 }}><input type="checkbox" name="includeQuery" defaultChecked={!!c.crawl?.includeQuery} /> Treat <code>?query</code> URLs as separate pages</label>
      </fieldset>

      <fieldset>
        <legend>Content &amp; links</legend>
        <div className="form-grid">
          <label className="field">Spellcheck whitelist <span className="hint">Brand names, cities, jargon</span><textarea name="ignoreWords" defaultValue={j(c.content?.ignoreWords)} /></label>
          <label className="field">Allowed phone numbers <span className="hint">Any other tel: number warns</span><textarea name="phones" defaultValue={j(c.content?.phones)} /></label>
          <label className="field">Links to skip <span className="hint">Regex per line</span><textarea name="linkIgnore" defaultValue={j(c.links?.ignore)} placeholder="linkedin\.com" /></label>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 20 }}>
          <label className="check"><input type="checkbox" name="externalLinks" defaultChecked={c.links?.external !== false} /> Check external links</label>
          <label className="check"><input type="checkbox" name="spellcheckCapitalized" defaultChecked={!!c.content?.spellcheckCapitalized} /> Spellcheck Capitalized words (noisier)</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Screenshots</legend>
        <div className="form-grid">
          <label className="field">
            Mask selectors
            <span className="hint">CSS selectors hidden before screenshots (things that change on every load). Moving content and phone numbers are handled automatically.</span>
            <textarea name="mask" defaultValue={j(c.visual?.mask)} placeholder={'.reviews-widget\n#live-chat'} />
          </label>
          <label className="field">Change threshold % <span className="hint">Default 0.5</span><input type="number" name="threshold" step="0.1" min="0.1" defaultValue={c.visual?.threshold} /></label>
          <label className="field">Registrable domain <span className="hint">Only for multi-part TLDs like example.co.uk</span><input type="text" name="domain" defaultValue={c.domain} /></label>
        </div>
      </fieldset>

      {state.error && <div className="alert alert-error">{state.error}</div>}
      <div className="row"><Submit pendingText="Saving…">{site ? 'Save changes' : 'Add site'}</Submit></div>
    </form>
  );
}
