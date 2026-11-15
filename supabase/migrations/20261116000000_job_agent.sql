-- JobPilot daily job agent: every morning it scans your Discover boards for new jobs, keeps them in your inbox
-- (website → Daily jobs) and emails you one digest. Run once in Supabase → SQL Editor.

-- Your agent settings (one row per user)
create table if not exists public.agent_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- Where the digest goes ('' = your sign-in email)
  email text not null default '',
  -- Only email jobs scoring at least this (0 = all that pass your Discover filters)
  min_score int not null default 0 check (min_score between 0 and 100),
  last_run_at timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

-- Jobs the agent found for you; one row per job, so a job is processed and emailed only once
create table if not exists public.agent_jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_key text not null,
  data jsonb not null,
  score int,
  status text not null default 'new' check (status in ('new', 'opened', 'applied', 'dismissed')),
  first_seen_at timestamptz not null default now(),
  emailed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, job_key)
);
create index if not exists agent_jobs_user_seen on public.agent_jobs (user_id, first_seen_at desc);

alter table public.agent_settings enable row level security;
alter table public.agent_jobs enable row level security;

drop policy if exists "own agent settings" on public.agent_settings;
create policy "own agent settings" on public.agent_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own agent jobs" on public.agent_jobs;
create policy "own agent jobs" on public.agent_jobs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
