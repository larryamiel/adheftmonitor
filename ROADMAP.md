# Adheft Monitor: Roadmap

Goal: monitor internal sites' vitals and run a QA checklist on a schedule (every ~2h) and on demand
("I just changed something, is everything still good?"). Scripts only, no AI agents, $0/month.

## Architecture (all free tiers)

| Piece | Runs on | Free limit that matters |
|---|---|---|
| QA engine (CLI, Playwright + Chromium) | Your machine + GitHub Actions | Private repo: 2,000 min/month. Public repo: unlimited |
| Scheduler (every 2h) + "Run now" | GitHub Actions `schedule` + `workflow_dispatch` | Same minutes as above |
| Results history + screenshots | Supabase (Postgres + Storage) | 500 MB DB, 1 GB storage |
| Dashboard | Vercel Hobby (Next.js) | No cron needed on Vercel: GitHub does the scheduling |
| Core Web Vitals | Google PageSpeed Insights API | 25k requests/day with a free key |
| Alerts | Slack / Discord webhook | Free |

**Minute budget (private repo):** GitHub rounds each job up to a whole minute. A full run of all sites in one
job taking ~4 min × 12 runs/day × 30 days ≈ 1,440 min/month: fits. If it outgrows that: run the full
browser suite every 4h and a lightweight HTTP-only check every 2h, or make the repo public
(no secrets live in the code; they live in GitHub Secrets).

## Phase 1: CLI QA engine ✅ done
`npm run qa -- --site <name>` → console report, JSON report in `reports/`, exit code 1 on failures,
diff against the previous run ("what did my change break / fix").

- **Health:** HTTP status, TTFB, load time, SSL expiry, domain expiry (RDAP), http→https and www redirects, redirect chains, real 404 page (no soft-404)
- **SEO:** title/description presence + length, duplicates across pages, one H1, canonical, `noindex` in meta **and** `X-Robots-Tag`, robots.txt not blocking the site, sitemap valid, `lang`, viewport, Open Graph, image alt text, JSON-LD parses
- **Tracking:** verified by *network requests actually firing*, not just strings in HTML: GTM container IDs, GA4 IDs, Meta Pixel PageView, CallRail swap.js, dataLayer, plus custom tags (LinkedIn, TikTok, etc.) via regex. Expected IDs per site, so a *wrong* ID fails too. Analytics hits are intercepted and **not sent**, so monitoring never pollutes GA4/Meta data. Optional consent-banner click first.
- **Content:** spellcheck (Hunspell en-US + per-site whitelist), placeholder text (lorem ipsum, TODO, `{{`, `undefined`, `NaN`…), staging/localhost URLs leaked, stale copyright year, malformed `tel:` links / unexpected phone numbers
- **Errors:** JS console errors, uncaught exceptions, failed requests, broken images, mixed content
- **Links:** every internal + external link checked (dedup'd, concurrency-limited, bot-blocking sites downgraded to warning)
- **Security:** HSTS, X-Content-Type-Options, clickjacking protection, Referrer-Policy

## Phase 2: Responsiveness, visual, accessibility, performance ✅ done
- Viewports: 320, 375, 414, 768, 1024, 1280, 1440, 1920
- Per viewport score: horizontal overflow, off-screen elements, small tap targets (<44px), tiny text (<12px), images wider than their containers
- Full-page screenshots + pixel diff vs approved baseline (`pixelmatch`), `--approve` to accept new baseline
- Accessibility: `axe-core` (contrast, labels, ARIA, headings)
- Core Web Vitals: PageSpeed Insights API (lab + CrUX field data: LCP, INP, CLS)
- Page weight + oversized/non-modern image formats

## Phase 3: Automation ✅ done (needs your Supabase project + GitHub repo)
- `.github/workflows/qa.yml`: cron `0 */2 * * *` + `workflow_dispatch` (inputs: site, pages), one parallel job per site
- Full-site crawl (all pages), sites stored in the DB, managed with `npm run sites`
- Results → Supabase tables (`runs`, `results`), screenshots → Supabase Storage
- Alerts → Slack/Discord only on **new** failures or score drops (no alert spam), plus "recovered" messages
- Optional: run QA automatically after each deploy (deploy webhook → `repository_dispatch`)

## Phase 4: Dashboard (Vercel) ✅ done
- Sites overview: overall score + per-category scores, last run, trend sparkline
- Run detail: grouped checklist, failures first, diff vs previous run
- Responsiveness grid: screenshot per viewport with diff overlay; approve-baseline button
- **"Run QA now"** button → GitHub `workflow_dispatch` API → live status
- Simple auth (single password or Supabase auth) since it's internal

## Phase 5: Extras
- Content-change detection on pages you didn't touch (defacement / unexpected CMS edits)
- DNS + MX record change monitoring (catches silent email breakage)
- Cookie banner present, privacy policy page reachable, favicon, `security.txt`
- Optional AI grammar pass only on *changed* text (cents/month), or LanguageTool free API
- Weekly digest email/Slack summary
