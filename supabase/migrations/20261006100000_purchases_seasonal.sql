-- Seasonal items: a temporary "Seasonal" category (Menu > Seasonal item). It only shows in the app while it has
-- items, sits at the top of the main list and last on the shopping list, and Full Reset empties it.
-- Items are added through the existing purchases_add_item; nothing new is needed for that.

alter table public.purchases_categories add column if not exists seasonal boolean not null default false;

insert into public.purchases_categories (id, name, sub, hue, sort, shop_sort, seasonal)
values (12, 'Seasonal', 'Until the next reset', '#7BC47F', 0, 12, true)
on conflict (id) do update set name = excluded.name, sub = excluded.sub, hue = excluded.hue,
  sort = excluded.sort, shop_sort = excluded.shop_sort, seasonal = excluded.seasonal;

-- Removes every seasonal item. Shopping-list ticks for them go too (on delete cascade).
-- Called by purchases_reset_history (reset History migration) after the reset snapshot and the wipe of purchases_sessions,
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
