-- Yoʻlda — автомобиль водителя и проверка водителей админом (как в inDrive).
-- Запускать после 005_admin_delete.sql.

alter table public.profiles
  add column if not exists car_make text not null default '' check (char_length(car_make) <= 40),
  add column if not exists car_model text not null default '' check (char_length(car_model) <= 40),
  add column if not exists car_color text not null default '' check (char_length(car_color) <= 30),
  add column if not exists car_year int check (car_year is null or car_year between 1970 and 2100),
  add column if not exists car_number text not null default '' check (char_length(car_number) <= 20),
  add column if not exists driver_status text not null default 'none'
    check (driver_status in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists driver_note text not null default '';

-- Машину (без госномера) и статус видят все; госномер — только через driver_plate()
grant select (car_make, car_model, car_color, car_year, driver_status) on public.profiles to authenticated;

-- Новый водитель сразу попадает «на проверку»
create or replace function public.profiles_driver_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role = 'driver' and new.driver_status = 'none' then
    new.driver_status := 'pending';
  end if;
  return new;
end;
$$;

create trigger profiles_driver_status
  before insert or update of role on public.profiles
  for each row execute function public.profiles_driver_status();

-- Водитель сохраняет данные машины. Если машина изменилась у одобренного — снова на проверку.
create or replace function public.submit_driver_car(p_make text, p_model text, p_color text, p_year int, p_number text)
returns text language plpgsql security definer set search_path = public as $$
declare cur public.profiles; st text;
begin
  select * into cur from profiles where id = auth.uid();
  if cur.id is null then raise exception 'no profile'; end if;
  if cur.role <> 'driver' then raise exception 'not a driver'; end if;
  p_number := upper(trim(p_number));
  if coalesce(trim(p_make), '') = '' or coalesce(trim(p_model), '') = '' or p_number = '' then
    raise exception 'car details required';
  end if;
  st := case
    when cur.driver_status = 'approved' and cur.car_make = trim(p_make) and cur.car_model = trim(p_model)
         and cur.car_number = p_number then 'approved'
    else 'pending' end;
  update profiles set car_make = trim(p_make), car_model = trim(p_model), car_color = trim(coalesce(p_color, '')),
    car_year = p_year, car_number = p_number, driver_status = st,
    driver_note = case when st = 'pending' then '' else driver_note end
  where id = auth.uid();
  return st;
end;
$$;

-- Свой профиль водителя целиком (с госномером и причиной отказа)
create or replace function public.my_driver()
returns table (car_make text, car_model text, car_color text, car_year int, car_number text, driver_status text, driver_note text)
language sql security definer stable set search_path = public as $$
  select p.car_make, p.car_model, p.car_color, p.car_year, p.car_number, p.driver_status, p.driver_note
  from public.profiles p where p.id = auth.uid();
$$;

-- Госномер виден пассажиру только после подтверждения поездки с этим водителем
create or replace function public.driver_plate(p_driver uuid)
returns text language sql security definer stable set search_path = public as $$
  select p.car_number from public.profiles p
  where p.id = p_driver and (
    p_driver = auth.uid() or public.is_admin()
    or exists (select 1 from public.bookings b join public.trips t on t.id = b.trip_id
               where t.driver_id = p_driver and b.passenger_id = auth.uid() and b.status = 'accepted')
    or exists (select 1 from public.offers o join public.ride_requests r on r.id = o.request_id
               where o.driver_id = p_driver and r.passenger_id = auth.uid() and o.status = 'accepted'));
$$;

-- Публиковать поездки и отправлять предложения могут только одобренные водители
create or replace function public.is_approved_driver()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'driver' and driver_status = 'approved' and not blocked
                   from public.profiles where id = auth.uid()), false);
$$;

alter policy "trips insert own" on public.trips
  with check (driver_id = auth.uid() and seats_free = seats_total and public.is_approved_driver());

alter policy "offers insert driver" on public.offers
  with check (
    driver_id = auth.uid() and status = 'pending' and public.is_approved_driver()
    and exists (select 1 from public.ride_requests r
                where r.id = request_id and r.status = 'open' and r.passenger_id <> auth.uid())
  );

-- ===== Админ: водители и машины =====
create or replace function public.admin_drivers()
returns table (id uuid, name text, phone text, email text,
               car_make text, car_model text, car_color text, car_year int, car_number text,
               driver_status text, driver_note text, cars text,
               trips bigint, offers bigint, rides_done bigint, avg_rating numeric, reviews bigint,
               blocked boolean, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
  select p.id, p.name, p.phone, u.email::text,
    p.car_make, p.car_model, p.car_color, p.car_year, p.car_number, p.driver_status, p.driver_note,
    (select string_agg(distinct c, ', ') from (
       select nullif(trim(t.car), '') c from trips t where t.driver_id = p.id
       union select nullif(trim(o.car), '') from offers o where o.driver_id = p.id) cs),
    (select count(*) from trips t where t.driver_id = p.id),
    (select count(*) from offers o where o.driver_id = p.id),
    (select count(*) from bookings b join trips t on t.id = b.trip_id where t.driver_id = p.id and b.status = 'accepted')
      + (select count(*) from offers o where o.driver_id = p.id and o.status = 'accepted'),
    (select round(avg(r.rating)::numeric, 1) from reviews r where r.driver_id = p.id),
    (select count(*) from reviews r where r.driver_id = p.id),
    p.blocked, p.created_at
  from profiles p join auth.users u on u.id = p.id
  where not p.is_admin and (p.role = 'driver' or p.driver_status <> 'none'
    or exists (select 1 from trips t where t.driver_id = p.id)
    or exists (select 1 from offers o where o.driver_id = p.id))
  order by case p.driver_status when 'pending' then 0 when 'rejected' then 1 when 'approved' then 2 else 3 end,
           p.created_at desc;
end;
$$;

create or replace function public.admin_set_driver_status(p_user uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'bad status'; end if;
  update profiles set driver_status = p_status, driver_note = coalesce(p_note, '') where id = p_user;
end;
$$;

revoke execute on function public.submit_driver_car(text, text, text, int, text), public.my_driver(),
  public.driver_plate(uuid), public.is_approved_driver(), public.admin_drivers(),
  public.admin_set_driver_status(uuid, text, text) from public, anon;
grant execute on function public.submit_driver_car(text, text, text, int, text), public.my_driver(),
  public.driver_plate(uuid), public.is_approved_driver(), public.admin_drivers(),
  public.admin_set_driver_status(uuid, text, text) to authenticated;

-- Данные для карточки водителя: рейтинг, поездки, проверка, машина (без госномера)
create or replace function public.driver_cards(p_ids uuid[])
returns table (driver_id uuid, avg_rating numeric, reviews_count bigint, rides_done bigint,
               verified boolean, car text)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select round(avg(r.rating)::numeric, 1) from reviews r where r.driver_id = p.id),
    (select count(*) from reviews r where r.driver_id = p.id),
    (select count(*) from bookings b join trips t on t.id = b.trip_id where t.driver_id = p.id and b.status = 'accepted')
      + (select count(*) from offers o where o.driver_id = p.id and o.status = 'accepted'),
    p.driver_status = 'approved',
    nullif(trim(concat_ws(' ', nullif(p.car_make, ''), nullif(p.car_model, '')) ||
      case when p.car_color <> '' then ', ' || p.car_color else '' end), '')
  from profiles p where p.id = any(p_ids);
$$;
revoke execute on function public.driver_cards(uuid[]) from public, anon;
grant execute on function public.driver_cards(uuid[]) to authenticated;
