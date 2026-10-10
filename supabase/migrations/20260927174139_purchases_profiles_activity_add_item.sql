-- Profiles (name + avatar), change log, user-added items, avatar uploads.

create table public.purchases_profiles (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 24 and name = btrim(name)),
  avatar text not null check (
    avatar ~ '^preset:[a-z0-9-]{1,24}$'
    or avatar ~ '^https://cqqeffacjibhkahbfjzu\.supabase\.co/storage/v1/object/public/purchases-avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index purchases_profiles_name_key on public.purchases_profiles (lower(name));
alter table public.purchases_profiles enable row level security;
create policy "profiles read" on public.purchases_profiles for select to anon, authenticated using (true);
grant select on public.purchases_profiles to anon, authenticated;

-- Each profile's device key (sha256), so only the device that created a profile can edit it.
create table purchases_private.profile_keys (
  profile_id uuid primary key references public.purchases_profiles(id) on delete cascade,
  key_hash text not null
);

create function public.purchases_profile_save(p_id uuid, p_key text, p_name text, p_avatar text)
returns public.purchases_profiles
language plpgsql security definer set search_path = '' as $$
declare h text; k text; r public.purchases_profiles;
begin
  if p_id is null or p_key is null or length(p_key) not between 16 and 128 then raise exception 'bad_key'; end if;
  h := encode(extensions.digest(p_key, 'sha256'), 'hex');
  select key_hash into k from purchases_private.profile_keys where profile_id = p_id;
  if k is not null and k <> h then raise exception 'not_yours'; end if;
  if k is null and (select count(*) from public.purchases_profiles) >= 200 then raise exception 'full'; end if;
  begin
    insert into public.purchases_profiles (id, name, avatar)
    values (p_id, regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), p_avatar)
    on conflict (id) do update set name = excluded.name, avatar = excluded.avatar, updated_at = now()
    returning * into r;
  exception when unique_violation then raise exception 'name_taken';
  end;
  if k is null then insert into purchases_private.profile_keys values (p_id, h); end if;
  return r;
end $$;
revoke all on function public.purchases_profile_save(uuid, text, text, text) from public;
grant execute on function public.purchases_profile_save(uuid, text, text, text) to anon, authenticated;

-- Who confirmed each day.
alter table public.purchases_sessions
  add column saved_by_profile uuid references public.purchases_profiles(id) on delete set null;

-- Change log: written only by triggers / definer functions; the app can read it.
create table public.purchases_activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  profile_id uuid references public.purchases_profiles(id) on delete set null,
  kind text not null check (kind in ('save', 'add_item', 'reset')),
  day date,
  details jsonb not null default '{}'::jsonb
);
create index purchases_activity_at_idx on public.purchases_activity (at desc);
alter table public.purchases_activity enable row level security;
create policy "activity read" on public.purchases_activity for select to anon, authenticated using (true);
grant select on public.purchases_activity to anon, authenticated;

-- On every confirm, record exactly which items changed (added / removed / new qty or unit).
create function purchases_private.log_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare changes jsonb;
begin
  if tg_op = 'UPDATE' and new.items = old.items then return new; end if;
  with o as (select e->>'item_id' id, (e->>'qty')::numeric qty, e->>'unit' unit
               from jsonb_array_elements(case when tg_op = 'UPDATE' then old.items else '[]'::jsonb end) e),
       n as (select e->>'item_id' id, (e->>'qty')::numeric qty, e->>'unit' unit from jsonb_array_elements(new.items) e)
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', coalesce(n.id, o.id),
           'from', case when o.id is null then null else jsonb_build_object('qty', o.qty, 'unit', o.unit) end,
           'to',   case when n.id is null then null else jsonb_build_object('qty', n.qty, 'unit', n.unit) end)), '[]'::jsonb)
    into changes
    from o full join n on o.id = n.id
   where o.id is null or n.id is null or o.qty <> n.qty or o.unit is distinct from n.unit;
  if jsonb_array_length(changes) = 0 then return new; end if;
  insert into public.purchases_activity (profile_id, kind, day, details)
  values (new.saved_by_profile, 'save', new.day, jsonb_build_object('changes', changes, 'count', jsonb_array_length(new.items)));
  return new;
end $$;
create trigger purchases_sessions_log after insert or update on public.purchases_sessions
  for each row execute function purchases_private.log_session();

-- User-added items.
alter table public.purchases_items
  add column added_by uuid references public.purchases_profiles(id) on delete set null,
  add column created_at timestamptz not null default now();

create function public.purchases_add_item(p_name text, p_category smallint, p_unit text, p_profile uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare nm text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); slug text; nid text; s smallint;
begin
  if char_length(nm) not between 1 and 40 then raise exception 'bad_name'; end if;
  if p_unit is null or p_unit <> all (array['kg','g','L','ml','pcs','pack','bottle','box','can','jar','bag','roll','carton','dozen','tray']) then raise exception 'bad_unit'; end if;
  if not exists (select 1 from public.purchases_categories where id = p_category) then raise exception 'bad_category'; end if;
  if p_profile is null or not exists (select 1 from public.purchases_profiles where id = p_profile) then raise exception 'no_profile'; end if;
  if exists (select 1 from public.purchases_items where lower(name) = lower(nm)) then raise exception 'exists'; end if;
  if (select count(*) from public.purchases_items) >= 300 then raise exception 'full'; end if;
  slug := left(trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g')), 40);
  if slug = '' then slug := 'item'; end if;
  nid := slug;
  while exists (select 1 from public.purchases_items where id = nid) loop
    nid := slug || '-' || substr(md5(random()::text), 1, 4);
  end loop;
  select coalesce(max(sort), 0) + 1 into s from public.purchases_items;
  insert into public.purchases_items (id, name, category_id, default_unit, sort, added_by) values (nid, nm, p_category, p_unit, s, p_profile);
  insert into public.purchases_activity (profile_id, kind, details)
  values (p_profile, 'add_item', jsonb_build_object('item_id', nid, 'name', nm, 'category_id', p_category, 'unit', p_unit));
  return nid;
end $$;
revoke all on function public.purchases_add_item(text, smallint, text, uuid) from public;
grant execute on function public.purchases_add_item(text, smallint, text, uuid) to anon, authenticated;

-- Full Reset now records who did it (profile is optional so older app versions keep working).
drop function public.purchases_reset_history(text);
create function public.purchases_reset_history(passcode text, p_profile uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
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
  insert into public.purchases_activity (profile_id, kind, details)
  values ((select id from public.purchases_profiles where id = p_profile), 'reset', jsonb_build_object('days', n));
  return n;
end $$;
revoke all on function public.purchases_reset_history(text, uuid) from public;
grant execute on function public.purchases_reset_history(text, uuid) to anon, authenticated;

-- TRUNCATE bypasses RLS; the app never needs it on these tables.
revoke truncate on public.purchases_items, public.purchases_categories from anon, authenticated;

alter publication supabase_realtime add table public.purchases_items, public.purchases_profiles, public.purchases_activity;

-- Avatar photos: public bucket, small images only, one folder per profile id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchases-avatars', 'purchases-avatars', true, 204800, array['image/jpeg', 'image/png', 'image/webp']);
create policy "purchases avatars upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'purchases-avatars'
              and array_length(storage.foldername(name), 1) = 1
              and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$');
