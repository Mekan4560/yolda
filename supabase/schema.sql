-- Yoʻlda — схема базы для Supabase
-- Запуск: Supabase → SQL Editor → New query → вставить весь файл → Run

-- ============ ПРОФИЛИ ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

-- Профиль создаётся автоматически при регистрации
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ РЕЙСЫ ============
create table if not exists public.trips (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  from_region text not null,
  from_district text not null,
  to_region text not null,
  to_district text not null,
  depart_at timestamptz not null,
  meeting_point text not null default '',
  car text not null default '',
  seats_total int not null check (seats_total between 1 and 8),
  seats_free int not null check (seats_free >= 0),
  price int not null check (price >= 0),
  options text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'cancelled', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists trips_search_idx
  on public.trips (from_region, to_region, depart_at) where status = 'open';

-- ============ БРОНИ ============
create table if not exists public.bookings (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  seats int not null default 1 check (seats between 1 and 8),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (trip_id, passenger_id)
);

-- Свободные места пересчитываются автоматически при принятии / отмене брони
create or replace function public.sync_seats()
returns trigger language plpgsql security definer set search_path = public as $$
declare free int;
begin
  if tg_op = 'UPDATE' and old.status <> 'accepted' and new.status = 'accepted' then
    select seats_free into free from public.trips where id = new.trip_id for update;
    if free < new.seats then
      raise exception 'Недостаточно свободных мест';
    end if;
    update public.trips set seats_free = seats_free - new.seats where id = new.trip_id;
  elsif tg_op = 'UPDATE' and old.status = 'accepted' and new.status <> 'accepted' then
    update public.trips set seats_free = seats_free + old.seats where id = new.trip_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_sync_seats on public.bookings;
create trigger bookings_sync_seats
  after update of status on public.bookings
  for each row execute function public.sync_seats();

-- ============ ДОСТУП (RLS) ============
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.bookings enable row level security;

-- Профили: имя видят все вошедшие, менять можно только свой
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Рейсы: видят все вошедшие, создаёт и меняет только водитель
drop policy if exists "trips read" on public.trips;
create policy "trips read" on public.trips
  for select to authenticated using (true);
drop policy if exists "trips insert own" on public.trips;
create policy "trips insert own" on public.trips
  for insert to authenticated
  with check (driver_id = auth.uid() and seats_free = seats_total);
drop policy if exists "trips update own" on public.trips;
create policy "trips update own" on public.trips
  for update to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- Брони: видит пассажир и водитель этого рейса
drop policy if exists "bookings read" on public.bookings;
create policy "bookings read" on public.bookings
  for select to authenticated using (
    passenger_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.driver_id = auth.uid())
  );

-- Пассажир создаёт заявку только от себя, только «ожидает», не на свой рейс
drop policy if exists "bookings insert own" on public.bookings;
create policy "bookings insert own" on public.bookings
  for insert to authenticated with check (
    passenger_id = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.trips t
                where t.id = trip_id and t.driver_id <> auth.uid()
                  and t.status = 'open' and t.seats_free >= seats and t.depart_at > now())
  );

-- Водитель принимает/отклоняет заявки на свои рейсы
drop policy if exists "bookings driver update" on public.bookings;
create policy "bookings driver update" on public.bookings
  for update to authenticated
  using (
    status = 'pending'
    and exists (select 1 from public.trips t where t.id = trip_id and t.driver_id = auth.uid())
  )
  with check (
    status in ('accepted', 'rejected')
    and exists (select 1 from public.trips t where t.id = trip_id and t.driver_id = auth.uid())
  );

-- ============ ТЕЛЕФОНЫ ============
-- Телефон нельзя прочитать напрямую: только своё и участники подтверждённой поездки.
revoke select on public.profiles from anon, authenticated;
grant select (id, name, created_at) on public.profiles to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (name, phone) on public.profiles to authenticated;

create or replace function public.my_profile()
returns table (name text, phone text)
language sql security definer stable set search_path = public as $$
  select p.name, p.phone from public.profiles p where p.id = auth.uid();
$$;

-- Контакты по поездке: водитель видит подтверждённых пассажиров, подтверждённый пассажир — водителя
create or replace function public.trip_contacts(p_trip bigint)
returns table (user_id uuid, name text, phone text)
language sql security definer stable set search_path = public as $$
  select p.id, p.name, p.phone
  from public.trips t join public.profiles p on p.id = t.driver_id
  where t.id = p_trip
    and exists (select 1 from public.bookings b
                where b.trip_id = t.id and b.passenger_id = auth.uid() and b.status = 'accepted')
  union all
  select p.id, p.name, p.phone
  from public.trips t
  join public.bookings b on b.trip_id = t.id and b.status = 'accepted'
  join public.profiles p on p.id = b.passenger_id
  where t.id = p_trip and t.driver_id = auth.uid();
$$;

-- Менять можно только безопасные колонки (места считает база сама)
revoke update on public.trips from anon, authenticated;
grant update (status, meeting_point, car, price, options) on public.trips to authenticated;
revoke update on public.bookings from anon, authenticated;
grant update (status) on public.bookings to authenticated;

revoke execute on function public.my_profile() from anon;
revoke execute on function public.trip_contacts(bigint) from anon;

-- Пассажир может отменить свою заявку
drop policy if exists "bookings passenger cancel" on public.bookings;
create policy "bookings passenger cancel" on public.bookings
  for update to authenticated
  using (passenger_id = auth.uid())
  with check (passenger_id = auth.uid() and status = 'cancelled');
