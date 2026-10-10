-- One row per day: the confirmed list for that date. Re-confirming the same day replaces it.
create table public.purchases_sessions (
  day date primary key,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 32000),
  updated_at timestamptz not null default now()
);

create or replace function public.purchases_sessions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger purchases_sessions_touch before insert or update on public.purchases_sessions
for each row execute function public.purchases_sessions_touch();

alter table public.purchases_sessions enable row level security;
create policy "sessions read"   on public.purchases_sessions for select to anon, authenticated using (true);
create policy "sessions insert" on public.purchases_sessions for insert to anon, authenticated with check (true);
create policy "sessions update" on public.purchases_sessions for update to anon, authenticated using (true) with check (true);
-- No delete policy: only the passcode-protected function below can delete.

alter publication supabase_realtime add table public.purchases_sessions;

-- Admin passcode lives in a schema the API does not expose.
create schema if not exists purchases_private;
revoke all on schema purchases_private from public, anon, authenticated;

create table purchases_private.admin (
  id boolean primary key default true check (id),
  passcode_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz
);
-- Starter passcode for a fresh database. Change it after rebuilding:
--   update purchases_private.admin set passcode_hash = extensions.crypt('<new>', extensions.gen_salt('bf')) where id;
insert into purchases_private.admin (passcode_hash) values (extensions.crypt('1234', extensions.gen_salt('bf')));

-- Returns the number of dates deleted. 5 wrong passcodes lock reset for 15 minutes.
create or replace function public.purchases_reset_history(passcode text) returns integer
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
  return n;
end $$;

revoke all on function public.purchases_reset_history(text) from public;
grant execute on function public.purchases_reset_history(text) to anon, authenticated;
