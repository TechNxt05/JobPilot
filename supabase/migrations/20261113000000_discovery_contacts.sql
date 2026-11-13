-- Job discovery settings + recruiter contacts (private to each user).
-- Run in the Supabase SQL editor after the earlier migrations.

-- One row per user: which company boards to watch and the default filters ({ sources, hiddenDefaults, filters })
create table if not exists public.discovery_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The user's own recruiter / HR contact list. Never shared between users.
create table if not exists public.contacts (
  user_id           uuid not null references auth.users (id) on delete cascade,
  id                uuid not null default gen_random_uuid(),
  company           text not null check (char_length(company) between 1 and 200),
  -- Comparable company key (see companyKey() in packages/core/src/contacts.ts), for matching jobs to contacts
  company_key       text not null default '',
  email             text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  name              text not null default '',
  title             text not null default '',
  country           text not null default '',
  city              text not null default '',
  department        text not null default '',
  role_tags         text[] not null default '{}',
  source            text not null default '',
  linkedin          text not null default '',
  status            text not null default 'unverified' check (status in ('unverified', 'verified', 'bounced', 'do_not_contact')),
  outreach          text not null default 'none' check (outreach in ('none', 'drafted', 'sent', 'replied', 'no_reply')),
  last_contacted_at timestamptz,
  follow_up_on      date,
  notes             text not null default '' check (char_length(notes) <= 4000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, email)
);

create index if not exists contacts_user_company_idx on public.contacts (user_id, company_key);

alter table public.discovery_settings enable row level security;
alter table public.contacts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['discovery_settings', 'contacts'] loop
    execute format('drop policy if exists "own rows: select" on public.%I', t);
    execute format('drop policy if exists "own rows: insert" on public.%I', t);
    execute format('drop policy if exists "own rows: update" on public.%I', t);
    execute format('drop policy if exists "own rows: delete" on public.%I', t);
    execute format('create policy "own rows: select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
