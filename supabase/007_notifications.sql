-- Yoʻlda — уведомления: база сама создаёт их при событиях, приложение получает их сразу (Realtime).
-- Запускать после 006_driver_cars.sql.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  link text not null default '',
  data jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Видит, отмечает прочитанным и удаляет только получатель. Создаёт только база (триггеры).
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

-- Новые уведомления приходят в приложение без перезагрузки
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- Создать уведомление (служебная функция, вызывают только триггеры)
create or replace function public.notify(p_user uuid, p_kind text, p_link text, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, link, data)
  select p_user, p_kind, p_link, coalesce(p_data, '{}')
  where p_user is not null and p_user is distinct from auth.uid();
$$;

-- ============ БРОНИ НА РЕЙСЫ ============
create or replace function public.notify_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare tr trips; who text;
begin
  select * into tr from trips where id = new.trip_id;
  select name into who from profiles where id = new.passenger_id;
  if tg_op = 'INSERT' then
    perform notify(tr.driver_id, 'booking_new', '#/driver/' || tr.id,
      jsonb_build_object('from', tr.from_district, 'to', tr.to_district, 'at', tr.depart_at, 'name', who, 'seats', new.seats));
  elsif new.status is distinct from old.status then
    if new.status in ('accepted', 'rejected') then
      perform notify(new.passenger_id, 'booking_' || new.status, '#/trip/' || tr.id,
        jsonb_build_object('from', tr.from_district, 'to', tr.to_district, 'at', tr.depart_at));
    elsif new.status = 'cancelled' then
      perform notify(tr.driver_id, 'booking_cancelled', '#/driver/' || tr.id,
        jsonb_build_object('from', tr.from_district, 'to', tr.to_district, 'at', tr.depart_at, 'name', who));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_notify on public.bookings;
create trigger bookings_notify
  after insert or update of status on public.bookings
  for each row execute function public.notify_booking();

-- Водитель (или админ) отменил рейс — сообщить пассажирам
create or replace function public.notify_trip_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform notify(b.passenger_id, 'trip_cancelled', '#/trip/' || new.id,
      jsonb_build_object('from', new.from_district, 'to', new.to_district, 'at', new.depart_at))
    from bookings b where b.trip_id = new.id and b.status in ('pending', 'accepted');
  end if;
  return new;
end;
$$;
drop trigger if exists trips_notify on public.trips;
create trigger trips_notify
  after update of status on public.trips
  for each row execute function public.notify_trip_cancel();

-- ============ ЗАЯВКИ И ПРЕДЛОЖЕНИЯ ============
create or replace function public.notify_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare rq ride_requests; who text;
begin
  select * into rq from ride_requests where id = new.request_id;
  if tg_op = 'INSERT' then
    select name into who from profiles where id = new.driver_id;
    perform notify(rq.passenger_id, 'offer_new', '#/request/' || rq.id,
      jsonb_build_object('from', rq.from_district, 'to', rq.to_district, 'date', rq.ride_date,
                         'name', who, 'price', new.price, 'time', new.depart_time));
  elsif new.status is distinct from old.status and new.status in ('accepted', 'rejected') then
    perform notify(new.driver_id, 'offer_' || new.status, '#/request/' || rq.id,
      jsonb_build_object('from', rq.from_district, 'to', rq.to_district, 'date', rq.ride_date));
  end if;
  return new;
end;
$$;
drop trigger if exists offers_notify on public.offers;
create trigger offers_notify
  after insert or update of status on public.offers
  for each row execute function public.notify_offer();

-- Пассажир отменил заявку — сообщить водителям, которые ждут ответа
create or replace function public.notify_request_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform notify(o.driver_id, 'request_cancelled', '#/request/' || new.id,
      jsonb_build_object('from', new.from_district, 'to', new.to_district, 'date', new.ride_date))
    from offers o where o.request_id = new.id and o.status = 'pending';
  end if;
  return new;
end;
$$;
drop trigger if exists ride_requests_notify on public.ride_requests;
create trigger ride_requests_notify
  after update of status on public.ride_requests
  for each row execute function public.notify_request_cancel();

-- Новый комментарий — автору заявки, водителям с предложениями и другим участникам обсуждения
create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare rq ride_requests; who text;
begin
  select * into rq from ride_requests where id = new.request_id;
  select name into who from profiles where id = new.author_id;
  perform notify(u.id, 'comment_new', '#/request/' || rq.id,
    jsonb_build_object('from', rq.from_district, 'to', rq.to_district, 'date', rq.ride_date,
                       'name', who, 'text', left(new.text, 120)))
  from (
    select rq.passenger_id as id
    union select o.driver_id from offers o where o.request_id = rq.id and o.status <> 'withdrawn'
    union select c.author_id from request_comments c where c.request_id = rq.id
  ) u
  where u.id <> new.author_id;
  return new;
end;
$$;
drop trigger if exists request_comments_notify on public.request_comments;
create trigger request_comments_notify
  after insert on public.request_comments
  for each row execute function public.notify_comment();

-- ============ ПРОВЕРКА ВОДИТЕЛЯ ============
create or replace function public.notify_driver_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.driver_status is distinct from old.driver_status and new.driver_status in ('approved', 'rejected') then
    perform notify(new.id, 'driver_' || new.driver_status, '#/car', jsonb_build_object('note', new.driver_note));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_notify on public.profiles;
create trigger profiles_notify
  after update of driver_status on public.profiles
  for each row execute function public.notify_driver_status();

revoke execute on function public.notify(uuid, text, text, jsonb), public.notify_booking(), public.notify_trip_cancel(),
  public.notify_offer(), public.notify_request_cancel(), public.notify_comment(), public.notify_driver_status()
  from public, anon, authenticated;
