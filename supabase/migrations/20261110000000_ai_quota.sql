-- Hosted AI daily quota (shared by the website and the extension).
-- Users can READ their own usage; only consume_ai_quota() can change it, and the limit lives in
-- ai_config (not a parameter), so a user calling the function directly can't raise their own limit.

create table if not exists public.ai_config (
  id          boolean primary key default true check (id), -- single row
  daily_limit integer not null default 20 check (daily_limit between 1 and 1000)
);
insert into public.ai_config (id, daily_limit) values (true, 20) on conflict (id) do nothing;
alter table public.ai_config enable row level security;
-- No policies: only the database owner (dashboard / SQL editor) can change the limit.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
drop policy if exists "own usage: select" on public.ai_usage;
create policy "own usage: select" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: writes only happen inside the function below.

-- Use one AI action for the calling user. Returns { allowed, remaining, limit }.
create or replace function public.consume_ai_quota()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim integer;
  used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select daily_limit into lim from public.ai_config where id;
  lim := coalesce(lim, 20);

  insert into public.ai_usage as u (user_id, day, count)
  values (uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = u.count + 1
  where u.count < lim
  returning u.count into used;

  if used is null then
    return json_build_object('allowed', false, 'remaining', 0, 'limit', lim);
  end if;
  return json_build_object('allowed', true, 'remaining', lim - used, 'limit', lim);
end;
$$;

revoke all on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;

-- Read-only view of today's remaining quota for the caller (no consumption)
create or replace function public.ai_quota_status()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'limit', c.daily_limit,
    'remaining', greatest(c.daily_limit - coalesce((select count from public.ai_usage where user_id = auth.uid() and day = (now() at time zone 'utc')::date), 0), 0)
  )
  from public.ai_config c where c.id;
$$;
revoke all on function public.ai_quota_status() from public, anon;
grant execute on function public.ai_quota_status() to authenticated;
