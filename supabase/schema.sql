-- Adheft Monitor schema. Paste into Supabase → SQL Editor → Run. Safe to re-run.

create extension if not exists pgcrypto;

-- Sites to monitor. `config` holds everything from SiteConfig except name/baseUrl
-- (tracking IDs, ignoreWords, crawl excludes, …).
create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (name ~ '^[a-z0-9][a-z0-9-]*$'),
  base_url    text not null,
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per QA run of one site. Kept forever (small) for trend charts.
create table if not exists runs (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references sites(id) on delete cascade,
  trigger      text not null default 'cli',          -- schedule | manual | deploy | cli
  partial      boolean not null default false,        -- --pages run: never used as a diff baseline
  status       text not null default 'running',      -- running | passed | failed | error
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer,
  pages        text[] not null default '{}',
  scores       jsonb,                                -- {"overall":91,"seo":88,...}
  counts       jsonb,                                -- {"pass":1203,"warn":40,"fail":2,"info":12}
  new_issues   jsonb,                                -- diff vs previous run
  fixed        jsonb,
  error        text
);
alter table runs add column if not exists partial boolean not null default false;
alter table runs add column if not exists viewport_scores jsonb;
-- full = every page (daily) · quick = key pages (every 2h) · manual = --pages check
alter table runs add column if not exists kind text not null default 'full';  -- {"320":81,"1920":100}
create index if not exists runs_site_started on runs (site_id, started_at desc);

-- Non-passing results only (passes are counted in runs.counts). Pruned after 14 days.
create table if not exists results (
  id        bigserial primary key,
  run_id    uuid not null references runs(id) on delete cascade,
  check_id  text not null,
  category  text not null,
  status    text not null,
  message   text not null,
  page      text,
  details   jsonb
);
create index if not exists results_run on results (run_id);

-- Only the service role (GitHub Actions + dashboard server) may read/write.
alter table sites   enable row level security;
alter table runs    enable row level security;
alter table results enable row level security;

-- Housekeeping, called at the end of each run.
create or replace function prune_old_results(keep_days int default 14) returns void
language sql security definer as $$
  delete from results r using runs u
  where r.run_id = u.id and u.started_at < now() - make_interval(days => keep_days);
  update runs set status = 'error', error = 'timed out'
  where status = 'running' and started_at < now() - interval '6 hours';
$$;

-- Private bucket for visual baselines / current / diff screenshots: <site>/<page>/<width>/{baseline,current,diff}.png
insert into storage.buckets (id, name, public) values ('qa', 'qa', false) on conflict (id) do nothing;
