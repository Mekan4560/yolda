-- Yoʻlda — заявки пассажиров и предложения водителей (модель «пассажир выбирает водителя»).
-- Запускать после 002_roles_admin.sql.

create table if not exists public.ride_requests (
  id bigint generated always as identity primary key,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  from_region text not null,
  from_district text not null,
  to_region text not null,
  to_district text not null,
  ride_date date not null,
  time_pref text not null default 'any' check (time_pref in ('any', 'morning', 'day', 'evening')),
  seats int not null default 1 check (seats between 1 and 8),
  budget int check (budget is null or budget >= 0),
  comment text not null default '' check (char_length(comment) <= 300),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists ride_requests_open_idx on public.ride_requests (ride_date, from_region) where status = 'open';

create table if not exists public.offers (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.ride_requests(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  price int not null check (price >= 0),
  depart_time text not null check (depart_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  car text not null default '' check (char_length(car) <= 80),
  comment text not null default '' check (char_length(comment) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (request_id, driver_id)
);

alter table public.ride_requests enable row level security;
alter table public.offers enable row level security;

-- Заявки видят все вошедшие (водителям нужна лента), создаёт пассажир от себя
create policy "requests read" on public.ride_requests
  for select to authenticated using (true);
create policy "requests insert own" on public.ride_requests
  for insert to authenticated
  with check (passenger_id = auth.uid() and status = 'open' and public.is_active() and ride_date >= current_date);
-- Пассажир может только отменить свою открытую заявку
create policy "requests cancel own" on public.ride_requests
  for update to authenticated
  using (passenger_id = auth.uid() and status = 'open')
  with check (passenger_id = auth.uid() and status = 'cancelled');

-- Предложение видит водитель-автор и пассажир, чья заявка
create policy "offers read" on public.offers
  for select to authenticated using (
    driver_id = auth.uid()
    or exists (select 1 from public.ride_requests r where r.id = request_id and r.passenger_id = auth.uid())
  );
-- Предложение отправляет активный водитель на чужую открытую заявку
create policy "offers insert driver" on public.offers
  for insert to authenticated with check (
    driver_id = auth.uid() and status = 'pending' and public.is_active()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'driver')
    and exists (select 1 from public.ride_requests r
                where r.id = request_id and r.status = 'open' and r.passenger_id <> auth.uid())
  );
-- Водитель может отозвать своё ожидающее предложение
create policy "offers withdraw own" on public.offers
  for update to authenticated
  using (driver_id = auth.uid() and status = 'pending')
  with check (driver_id = auth.uid() and status = 'withdrawn');

-- Менять напрямую можно только статус (выбор водителя — через функцию)
revoke update on public.ride_requests from anon, authenticated;
grant update (status) on public.ride_requests to authenticated;
revoke update on public.offers from anon, authenticated;
grant update (status) on public.offers to authenticated;

-- Пассажир выбирает водителя: предложение принято, остальные отклонены, заявка закрыта
create or replace function public.choose_offer(p_offer bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_req bigint;
begin
  select o.request_id into v_req
  from offers o join ride_requests r on r.id = o.request_id
  where o.id = p_offer and o.status = 'pending' and r.status = 'open' and r.passenger_id = auth.uid()
  for update of r;
  if v_req is null then raise exception 'offer not available'; end if;
  update offers set status = 'accepted' where id = p_offer;
  update offers set status = 'rejected' where request_id = v_req and id <> p_offer and status = 'pending';
  update ride_requests set status = 'closed' where id = v_req;
end;
$$;

-- Контакты после выбора: пассажир видит выбранного водителя, выбранный водитель — пассажира
create or replace function public.request_contacts(p_request bigint)
returns table (user_id uuid, name text, phone text)
language sql security definer stable set search_path = public as $$
  select p.id, p.name, p.phone
  from offers o join profiles p on p.id = o.driver_id join ride_requests r on r.id = o.request_id
  where o.request_id = p_request and o.status = 'accepted' and r.passenger_id = auth.uid()
  union all
  select p.id, p.name, p.phone
  from ride_requests r join profiles p on p.id = r.passenger_id
  join offers o on o.request_id = r.id and o.status = 'accepted'
  where r.id = p_request and o.driver_id = auth.uid();
$$;

revoke execute on function public.choose_offer(bigint), public.request_contacts(bigint) from public, anon;
grant execute on function public.choose_offer(bigint), public.request_contacts(bigint) to authenticated;
