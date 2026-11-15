# Adheft Monitor

QA checklist + vitals monitor for our sites. Plain scripts (Playwright + Node), no AI, $0. See [ROADMAP.md](ROADMAP.md).

## Setup
```
npm install
npx playwright install chromium
```

## One-time setup (free)
1. **Supabase**: create a project → SQL Editor → paste and run [supabase/schema.sql](supabase/schema.sql).
2. Copy `.env.example` to `.env` and fill `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
3. Add sites: `npm run sites -- add mysite https://www.mysite.com` (every page is crawled by default).
4. **GitHub**: push this repo (public is fine; no secrets are in the code). Settings → Secrets and variables → Actions → add
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `ALERT_WEBHOOK_URL` (Slack/Discord).
5. Actions tab → **QA** → *Run workflow* once to test. After that it runs by itself:
   **quick check** of each site's key pages every 2 hours, **full crawl** of every page daily (07:30 UTC).

**Public repo privacy:** Actions logs are public, so jobs use anonymous site IDs and print only
`site 3f2a91c0 [quick]: score 84/100, 2 fail…`. Names, URLs and findings stay in the dashboard/database.
Runs that *find* problems still succeed (no GitHub failure emails); you're notified through alerts.
The workflow re-enables its own schedule, so GitHub's 60-day inactivity shutoff doesn't apply.


## Dashboard (Vercel, free Hobby plan)
The `dashboard/` folder is a Next.js app: site overview with scores and trends, the full checklist per run,
responsive scores per screen width, screenshot review with **Approve** buttons, site settings, and **Run QA now**.

1. Vercel → Add New Project → import this GitHub repo → set **Root Directory** to `dashboard`.
2. Environment variables (see [dashboard/.env.example](dashboard/.env.example)):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: same as above
   - `DASHBOARD_PASSWORD`: a long random password (it's the only lock on the dashboard)
   - `GITHUB_TOKEN`: GitHub → Settings → Developer settings → Fine-grained tokens → this repo only →
     Repository permissions → **Actions: Read and write**
   - `GITHUB_REPO`: `your-user/adheftmonitor`
3. Deploy. Add sites from the dashboard; the CLI `npm run sites` still works too.

Local dev: `cd dashboard && cp .env.example .env.local` (fill it in) `&& npm install && npm run dev`.

## Managing sites
`npm run sites -- list | add | set | enable | disable | remove | import`. Run `npm run sites` for help.
Sites live in the database; `sites.config.ts` is only for local runs without a database (`--source file`).

## Configure (legacy file mode)
Edit [sites.config.ts](sites.config.ts): one entry per site. Run once without `tracking` set: the report lists every
tag it detected (GTM, GA4, Meta, CallRail) so you can copy the IDs into the config. From then on a missing **or wrong** ID fails.

## Run
| Command | What it does |
|---|---|
| `npm run qa` | Full run, all enabled sites, **every page** (sitemap + link discovery, safety cap 5,000) |
| `npm run qa -- --site mysite` | One site |
| `npm run qa -- --site mysite --pages /,/contact` | **Manual check after a change**: only those pages, fast |
| `npm run qa -- --no-links` | Skip link checking (fastest) |
| `npm run qa -- --verbose` | Show passing checks + all details |
| `npm run qa -- --headed` | Watch the browser |
| `npm run qa -- --site mysite --pages /about --approve` | Accept an **intended** design change as the new screenshot baseline |
| `--no-responsive` `--no-a11y` `--no-visual` `--no-psi` | Skip individual check groups |

## What runs where
| Check | Pages |
|---|---|
| Health, SEO, tracking, content, errors, links, security | every page |
| **Responsive score** at 320 / 375 / 414 / 768 / 1024 / 1280 / 1440 / 1920 px | every page |
| Accessibility (axe-core, WCAG 2.2 AA) and page weight | every page |
| **Screenshot comparison** at 375 / 768 / 1280 / 1920 px | key pages (`keyPages`, default `/` + `pages`) |
| PageSpeed Insights + real-user Core Web Vitals | key pages (needs free `PSI_API_KEY`) |

For a manual `--pages` check, the pages you list are treated as key pages, so they also get screenshots.

**Screenshot comparison** auto-ignores moving content (two shots 1.5 s apart; whatever moves is ignored) and normalises
phone numbers (CallRail swaps them per visitor). For anything else that changes on every load, add CSS selectors
to the site's `visual.mask`. The first run of a page saves its baseline.

Every run saves `reports/<site>/<timestamp>.json` + `latest.json`, and prints **what's new / fixed since the last run**.
Exit code: `0` all pass, `1` at least one failure, `2` crash.

## Notes
- Analytics hits (GA4 collect, Meta `/tr`) are intercepted and answered locally, so runs never pollute your analytics.
  Tag *libraries* still load, which is what's verified. The browser UA ends in `AdheftMonitor/1.0` if you want to filter it anywhere else (e.g. CallRail).
- Severity: `fail` = broken / must fix, `warn` = should fix or verify, `info` = FYI. Scores: pass 1, warn 0.5, fail 0.
- Spellcheck ignores Capitalized words (names/places) by default; add brand terms to `content.ignoreWords`.
