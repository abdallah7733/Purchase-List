-- Seasonal items: a temporary "Seasonal" category (Menu > Seasonal item). It only shows in the app while it has
-- items, sits at the top of the main list and last on the shopping list, and Full Reset empties it.
-- Items are added through the existing purchases_add_item; nothing new is needed for that.

alter table public.purchases_categories add column if not exists seasonal boolean not null default false;

insert into public.purchases_categories (id, name, sub, hue, sort, shop_sort, seasonal)
values (12, 'Seasonal', 'Until the next reset', '#7BC47F', 0, 12, true)
on conflict (id) do update set name = excluded.name, sub = excluded.sub, hue = excluded.hue,
  sort = excluded.sort, shop_sort = excluded.shop_sort, seasonal = excluded.seasonal;

-- Removes every seasonal item. Shopping-list ticks for them go too (on delete cascade).
-- Called by purchases_reset_history (below) after the reset snapshot and the wipe of purchases_sessions,
-- so the archived file still lists the seasonal items. Not callable from the app on its own.
create or replace function public.purchases_clear_seasonal()
returns integer language plpgsql security definer set search_path to '' as $function$
declare n integer;
begin
  delete from public.purchases_items i
   using public.purchases_categories c
   where c.id = i.category_id and c.seasonal;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.purchases_clear_seasonal() from public, anon, authenticated;

-- Full Reset from 20261006090000_purchases_archives.sql (reset History), plus one step: after the snapshot
-- (which stores every item's name) and the wipe of days, the seasonal items are removed. Run after that file.
create or replace function public.purchases_reset_history(passcode text, p_profile uuid default null)
returns integer language plpgsql security definer set search_path to '' as $function$
declare n integer; who uuid; arch bigint;
begin
  if not purchases_private.passcode_ok(passcode) then return -1; end if;
  who := (select id from public.purchases_profiles where id = p_profile);
  insert into public.purchases_archives (reset_by, first_day, last_day, days, sessions, names)
  select who, min(s.day), max(s.day), count(*),
         jsonb_agg(jsonb_build_object('day', s.day, 'items', s.items, 'saved_by_profile', s.saved_by_profile, 'updated_at', s.updated_at) order by s.day desc),
         coalesce((select jsonb_object_agg(i.id, jsonb_build_object('name', i.name, 'category_id', i.category_id)) from public.purchases_items i), '{}'::jsonb)
    from public.purchases_sessions s
   where jsonb_array_length(coalesce(s.items, '[]'::jsonb)) > 0
  having count(*) > 0
  returning id into arch;
  delete from public.purchases_sessions where true;
  get diagnostics n = row_count;
  delete from public.purchases_shop_ticks where true;
  perform public.purchases_clear_seasonal();
  insert into public.purchases_activity (profile_id, kind, details)
  values (who, 'reset', jsonb_build_object('days', n, 'archive_id', arch));
  return n;
end $function$;
grant execute on function public.purchases_reset_history(text, uuid) to anon, authenticated;
