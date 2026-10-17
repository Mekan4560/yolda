-- Yoʻlda — место посадки в предложениях водителей и жалобы на пользователей.
-- Запускать после 007_notifications.sql.

-- Место посадки (ориентир): вокзал, автовокзал, рынок, метро…
alter table public.offers
  add column if not exists meeting_point text not null default '' check (char_length(meeting_point) <= 120);

-- ============ ЖАЛОБЫ ============
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  trip_id bigint references public.trips(id) on delete set null,
  request_id bigint references public.ride_requests(id) on delete set null,
  reason text not null check (reason in ('no_show', 'unsafe', 'rude', 'fraud', 'other')),
  text text not null default '' check (char_length(text) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);

alter table public.reports enable row level security;

-- Жалобу подаёт вошедший пользователь от своего имени; читать может только свои
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid() and status = 'open');
drop policy if exists "reports read own" on public.reports;
create policy "reports read own" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

revoke all on public.reports from anon, authenticated;
grant select, insert on public.reports to authenticated;

-- Админ: список жалоб с именами и сколько всего жалоб на пользователя
create or replace function public.admin_reports()
returns table (id bigint, created_at timestamptz, reason text, text text, status text,
               trip_id bigint, request_id bigint,
               reporter_name text, target_id uuid, target_name text, target_phone text,
               target_blocked boolean, target_reports bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select r.id, r.created_at, r.reason, r.text, r.status, r.trip_id, r.request_id,
           a.name, r.target_id, b.name, b.phone, b.blocked,
           (select count(*) from reports x where x.target_id = r.target_id)
    from reports r join profiles a on a.id = r.reporter_id join profiles b on b.id = r.target_id
    order by (r.status = 'open') desc, r.created_at desc limit 200;
end;
$$;

create or replace function public.admin_resolve_report(p_report bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update reports set status = 'resolved' where id = p_report;
end;
$$;

revoke execute on function public.admin_reports(), public.admin_resolve_report(bigint) from public, anon;
grant execute on function public.admin_reports(), public.admin_resolve_report(bigint) to authenticated;
