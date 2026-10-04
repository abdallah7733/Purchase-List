-- Shopping list: ticks shared live between phones, and a market-walk order for categories.

-- One row per item ticked off in the store. Unticking deletes the row; Full Reset clears them all.
create table if not exists public.purchases_shop_ticks (
  item_id text primary key references public.purchases_items(id) on delete cascade,
  ticked_by uuid,
  ticked_at timestamptz not null default now()
);
alter table public.purchases_shop_ticks enable row level security;
drop policy if exists "ticks read" on public.purchases_shop_ticks;
drop policy if exists "ticks add" on public.purchases_shop_ticks;
drop policy if exists "ticks remove" on public.purchases_shop_ticks;
create policy "ticks read" on public.purchases_shop_ticks for select to anon, authenticated using (true);
create policy "ticks add" on public.purchases_shop_ticks for insert to anon, authenticated with check (true);
create policy "ticks remove" on public.purchases_shop_ticks for delete to anon, authenticated using (true);
grant select, insert, delete on public.purchases_shop_ticks to anon, authenticated;
alter table public.purchases_shop_ticks replica identity full;   -- so the other phone hears which item was unticked
do $$ begin
  alter publication supabase_realtime add table public.purchases_shop_ticks;
exception when duplicate_object then null; end $$;

-- Order categories appear in on the shopping list (null = same as the main list).
alter table public.purchases_categories add column if not exists shop_sort smallint;

-- Full Reset also clears the ticks.
create or replace function public.purchases_reset_history(passcode text, p_profile uuid default null)
returns integer language plpgsql security definer set search_path to '' as $function$
declare a purchases_private.admin; n integer;
begin
  select * into a from purchases_private.admin where id for update;
  if a.locked_until is not null and a.locked_until > now() then
    raise exception 'locked' using hint = 'Too many wrong passcodes. Try again later.';
  end if;
  if passcode is null or extensions.crypt(passcode, a.passcode_hash) <> a.passcode_hash then
    update purchases_private.admin
       set failed_attempts = a.failed_attempts + 1,
           locked_until = case when a.failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id;
    return -1;
  end if;
  update purchases_private.admin set failed_attempts = 0, locked_until = null where id;
  delete from public.purchases_sessions where true;
  get diagnostics n = row_count;
  delete from public.purchases_shop_ticks where true;
  insert into public.purchases_activity (profile_id, kind, details)
  values ((select id from public.purchases_profiles where id = p_profile), 'reset', jsonb_build_object('days', n));
  return n;
end $function$;
