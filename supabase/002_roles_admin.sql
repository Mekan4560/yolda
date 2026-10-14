-- Yoʻlda — роли (водитель/пассажир), мастер-аккаунт, блокировка.
-- Запускать после 001_schema.sql.

alter table public.profiles
  add column if not exists role text not null default 'passenger' check (role in ('passenger', 'driver')),
  add column if not exists is_admin boolean not null default false,
  add column if not exists blocked boolean not null default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'role' = 'driver' then 'driver' else 'passenger' end
  );
  return new;
end;
$$;

-- Роль видна и меняется самим пользователем; is_admin и blocked — только админом через функции
grant select (role) on public.profiles to authenticated;
grant update (role) on public.profiles to authenticated;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_active()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select not blocked from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.me()
returns table (name text, phone text, role text, is_admin boolean, blocked boolean)
language sql security definer stable set search_path = public as $$
  select p.name, p.phone, p.role, p.is_admin, p.blocked from public.profiles p where p.id = auth.uid();
$$;

-- Только водители без блокировки публикуют рейсы
alter policy "trips insert own" on public.trips
  with check (
    driver_id = auth.uid() and seats_free = seats_total and public.is_active()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'driver')
  );

-- Заблокированный не может бронировать
alter policy "bookings insert own" on public.bookings
  with check (
    passenger_id = auth.uid()
    and status = 'pending'
    and public.is_active()
    and exists (select 1 from public.trips t
                where t.id = trip_id and t.driver_id <> auth.uid()
                  and t.status = 'open' and t.seats_free >= seats and t.depart_at > now())
  );

-- ===== Функции мастер-аккаунта =====
create or replace function public.admin_stats()
returns table (users bigint, drivers bigint, passengers bigint, blocked bigint,
               trips_open bigint, trips_total bigint, bookings_total bigint, bookings_accepted bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select
    (select count(*) from profiles), (select count(*) from profiles where role = 'driver'),
    (select count(*) from profiles where role = 'passenger'), (select count(*) from profiles where profiles.blocked),
    (select count(*) from trips where status = 'open' and depart_at > now()), (select count(*) from trips),
    (select count(*) from bookings), (select count(*) from bookings where status = 'accepted');
end;
$$;

create or replace function public.admin_users()
returns table (id uuid, name text, phone text, email text, role text, is_admin boolean, blocked boolean, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select p.id, p.name, p.phone, u.email::text, p.role, p.is_admin, p.blocked, p.created_at
    from profiles p join auth.users u on u.id = p.id order by p.created_at desc;
end;
$$;

create or replace function public.admin_trips()
returns table (id bigint, driver_name text, driver_phone text, from_region text, from_district text,
               to_region text, to_district text, depart_at timestamptz, seats_total int, seats_free int,
               price int, status text, pending bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select t.id, p.name, p.phone, t.from_region, t.from_district, t.to_region, t.to_district,
    t.depart_at, t.seats_total, t.seats_free, t.price, t.status,
    (select count(*) from bookings b where b.trip_id = t.id and b.status = 'pending')
    from trips t join profiles p on p.id = t.driver_id order by t.depart_at desc limit 200;
end;
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'cannot block yourself'; end if;
  update profiles set blocked = p_blocked where id = p_user;
  if p_blocked then
    update trips set status = 'cancelled' where driver_id = p_user and status = 'open';
  end if;
end;
$$;

create or replace function public.admin_cancel_trip(p_trip bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update trips set status = 'cancelled' where id = p_trip;
end;
$$;

revoke execute on function public.is_admin(), public.is_active(), public.me(), public.admin_stats(),
  public.admin_users(), public.admin_trips(), public.admin_set_blocked(uuid, boolean),
  public.admin_cancel_trip(bigint) from public, anon;
grant execute on function public.is_admin(), public.is_active(), public.me(), public.admin_stats(),
  public.admin_users(), public.admin_trips(), public.admin_set_blocked(uuid, boolean),
  public.admin_cancel_trip(bigint) to authenticated;

-- Назначить мастер-аккаунт (подставьте свой email):
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
