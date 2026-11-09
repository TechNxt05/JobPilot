-- Internova cloud sync (Phase 4)
-- Run in the Supabase SQL editor, or with the Supabase CLI: `supabase db push`.
--
-- Every synced table has the same shape so the extension (and later the web app) can sync them
-- generically: one JSON document per record, timestamps in epoch milliseconds, soft deletes.
-- Row Level Security restricts every row to its owner (auth.uid()).

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  id         text not null default 'me',
  data       jsonb,
  updated_at bigint not null,
  deleted_at bigint
);

create table if not exists public.resumes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb,
  updated_at bigint not null,
  deleted_at bigint,
  primary key (user_id, id)
);

create table if not exists public.answers (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb,
  updated_at bigint not null,
  deleted_at bigint,
  primary key (user_id, id)
);

create table if not exists public.applications (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb,
  updated_at bigint not null,
  deleted_at bigint,
  -- Queryable copies for the web app's tracker views
  status     text generated always as (data ->> 'status') stored,
  company    text generated always as (data ->> 'company') stored,
  primary key (user_id, id)
);

create index if not exists applications_user_status_idx on public.applications (user_id, status);

-- Row Level Security: each user can only see and change their own rows
alter table public.profiles     enable row level security;
alter table public.resumes      enable row level security;
alter table public.answers      enable row level security;
alter table public.applications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'resumes', 'answers', 'applications'] loop
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

-- Private storage bucket for original resume PDFs (optional; the extension syncs extracted text).
-- Files live under <user_id>/<file>, and only the owner can read or write them.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

drop policy if exists "resume files: own folder" on storage.objects;
create policy "resume files: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
