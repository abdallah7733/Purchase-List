-- Archive: every Full Reset first saves what was logged since the previous reset as one dated snapshot.
-- Snapshots are never added together; each covers only the days between two resets.

create table if not exists public.purchases_archives (
  id bigint generated always as identity primary key,
  reset_at timestamptz not null default now(),
  reset_by uuid references public.purchases_profiles(id) on delete set null,
  first_day date not null,
  last_day date not null,
  days integer not null,
  sessions jsonb not null,   -- [{day, items:[{item_id, qty, unit}], saved_by_profile, updated_at}], newest day first
  names jsonb not null       -- {item_id: {name, category_id}} at reset time, so renamed or deleted items still read right
);
alter table public.purchases_archives enable row level security;
drop policy if exists "archives read" on public.purchases_archives;
create policy "archives read" on public.purchases_archives for select to anon, authenticated using (true);
grant select on public.purchases_archives to anon, authenticated;   -- writes only through the passcode functions below
do $$ begin
  alter publication supabase_realtime add table public.purchases_archives;
exception when duplicate_object then null; end $$;

-- Shared passcode check: true when right, false when wrong (counts toward the 15-minute lock), raises 'locked' while locked.
create or replace function purchases_private.passcode_ok(passcode text)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare a purchases_private.admin;
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
    return false;
  end if;
  update purchases_private.admin set failed_attempts = 0, locked_until = null where id;
  return true;
end $function$;
revoke all on function purchases_private.passcode_ok(text) from public, anon, authenticated;

-- Full Reset: archive the period (skipped when nothing was logged), then clear days, shopping ticks and seasonal items.
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
  -- Seasonal items go after the snapshot, so the archived period still names them (Seasonal items, PR #12).
  if to_regprocedure('public.purchases_clear_seasonal()') is not null then
    perform public.purchases_clear_seasonal();
  end if;
  insert into public.purchases_activity (profile_id, kind, details)
  values (who, 'reset', jsonb_build_object('days', n, 'archive_id', arch));
  return n;
end $function$;

-- Delete one archived period (admin passcode). Returns 1 when deleted, 0 when already gone, -1 on a wrong passcode.
create or replace function public.purchases_delete_archive(passcode text, p_id bigint)
returns integer language plpgsql security definer set search_path to '' as $function$
declare n integer;
begin
  if not purchases_private.passcode_ok(passcode) then return -1; end if;
  delete from public.purchases_archives where id = p_id;
  get diagnostics n = row_count;
  return n;
end $function$;
grant execute on function public.purchases_reset_history(text, uuid) to anon, authenticated;
grant execute on function public.purchases_delete_archive(text, bigint) to anon, authenticated;
