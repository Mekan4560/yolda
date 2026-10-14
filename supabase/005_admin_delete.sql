-- Yoʻlda — права админа на удаление (пользователи, поездки, заявки, отзывы, комментарии).
-- Запускать после 004_reviews_comments_admin.sql.
-- Supabase → SQL Editor → New query → вставить весь файл → Run.

create policy "reviews delete own or admin" on public.reviews
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "comments delete own or admin" on public.request_comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create or replace function public.admin_delete_request(p_request bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from ride_requests where id = p_request;
end;
$$;

create or replace function public.admin_delete_trip(p_trip bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from trips where id = p_trip;
end;
$$;

-- Удаление пользователя целиком: его поездки, брони, заявки и предложения удаляются каскадно
create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'cannot delete yourself'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_admin) then raise exception 'cannot delete an admin'; end if;
  delete from auth.users where id = p_user;
end;
$$;

revoke execute on function public.admin_delete_request(bigint), public.admin_delete_trip(bigint),
  public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_request(bigint), public.admin_delete_trip(bigint),
  public.admin_delete_user(uuid) to authenticated;
