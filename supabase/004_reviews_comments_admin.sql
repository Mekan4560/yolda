-- Yoʻlda — отзывы о водителях, комментарии к заявкам, список заявок для админа.
-- Запускать после 003_requests_offers.sql.

-- ===== Отзывы о водителях =====
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  trip_id bigint references public.trips(id) on delete set null,
  request_id bigint references public.ride_requests(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  text text not null default '' check (char_length(text) <= 500),
  created_at timestamptz not null default now(),
  unique (author_id, trip_id),
  unique (author_id, request_id)
);
-- trip_id/request_id обнуляются при удалении поездки/заявки — отзыв о водителе при этом сохраняется
create index if not exists reviews_driver_idx on public.reviews (driver_id, created_at desc);

alter table public.reviews enable row level security;

create policy "reviews read" on public.reviews
  for select to authenticated using (true);

-- Отзыв оставляет только пассажир, который реально ехал с этим водителем
create policy "reviews insert passenger" on public.reviews
  for insert to authenticated with check (
    author_id = auth.uid() and driver_id <> auth.uid() and public.is_active()
    and (
      (reviews.trip_id is not null and exists (
        select 1 from public.trips t join public.bookings b on b.trip_id = t.id
        where t.id = reviews.trip_id and t.driver_id = reviews.driver_id
          and b.passenger_id = auth.uid() and b.status = 'accepted'))
      or
      (reviews.request_id is not null and exists (
        select 1 from public.ride_requests r join public.offers o on o.request_id = r.id
        where r.id = reviews.request_id and r.passenger_id = auth.uid()
          and o.driver_id = reviews.driver_id and o.status = 'accepted'))
    )
  );

revoke update on public.reviews from anon, authenticated;

-- Средний рейтинг водителей (для карточек)
create or replace function public.driver_ratings(p_ids uuid[])
returns table (driver_id uuid, avg_rating numeric, reviews_count bigint)
language sql stable set search_path = public as $$
  select r.driver_id, round(avg(r.rating)::numeric, 1), count(*)
  from public.reviews r where r.driver_id = any(p_ids) group by r.driver_id;
$$;

-- ===== Комментарии к заявкам =====
create table if not exists public.request_comments (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.ride_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists request_comments_idx on public.request_comments (request_id, created_at);

alter table public.request_comments enable row level security;

create policy "comments read" on public.request_comments
  for select to authenticated using (true);
create policy "comments insert" on public.request_comments
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_active()
    and exists (select 1 from public.ride_requests r where r.id = request_comments.request_id and r.status <> 'cancelled')
  );

revoke update on public.request_comments from anon, authenticated;

-- ===== Админ: заявки, удаление =====
create or replace function public.admin_requests()
returns table (id bigint, passenger_name text, passenger_phone text, from_region text, from_district text,
               to_region text, to_district text, ride_date date, seats int, budget int, status text,
               offers bigint, comments bigint, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select r.id, p.name, p.phone, r.from_region, r.from_district, r.to_region, r.to_district,
    r.ride_date, r.seats, r.budget, r.status,
    (select count(*) from offers o where o.request_id = r.id and o.status <> 'withdrawn'),
    (select count(*) from request_comments c where c.request_id = r.id),
    r.created_at
    from ride_requests r join profiles p on p.id = r.passenger_id order by r.created_at desc limit 300;
end;
$$;

revoke execute on function public.driver_ratings(uuid[]), public.admin_requests() from public, anon;
grant execute on function public.driver_ratings(uuid[]), public.admin_requests() to authenticated;

-- Права на удаление — в 005_admin_delete.sql
