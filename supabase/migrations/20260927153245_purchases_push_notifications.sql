create extension if not exists pg_net;

-- Which device saved the list, so that device isn't notified about its own change.
alter table public.purchases_sessions add column saved_by text check (saved_by is null or length(saved_by) <= 64);

-- VAPID keys + webhook secret (row is inserted separately, never in a migration).
create table purchases_private.push_config (
  id boolean primary key default true check (id),
  vapid_public text not null,
  vapid_private text not null,
  subject text not null,
  hook_secret text not null
);

create table purchases_private.push_subs (
  endpoint text primary key check (length(endpoint) <= 1024),
  p256dh text not null check (length(p256dh) <= 256),
  auth text not null check (length(auth) <= 64),
  device_id text check (device_id is null or length(device_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.purchases_push_subscribe(sub_endpoint text, sub_p256dh text, sub_auth text, sub_device text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if sub_endpoint !~ '^https://' then raise exception 'bad endpoint'; end if;
  if (select count(*) from purchases_private.push_subs) >= 100
     and not exists (select 1 from purchases_private.push_subs where endpoint = sub_endpoint) then
    raise exception 'too many subscriptions';
  end if;
  insert into purchases_private.push_subs (endpoint, p256dh, auth, device_id)
  values (sub_endpoint, sub_p256dh, sub_auth, sub_device)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, device_id = excluded.device_id, updated_at = now();
end $$;

create or replace function public.purchases_push_unsubscribe(sub_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from purchases_private.push_subs where endpoint = sub_endpoint;
end $$;

revoke all on function public.purchases_push_subscribe(text, text, text, text) from public;
revoke all on function public.purchases_push_unsubscribe(text) from public;
grant execute on function public.purchases_push_subscribe(text, text, text, text) to anon, authenticated;
grant execute on function public.purchases_push_unsubscribe(text) to anon, authenticated;

-- On every confirmed list (new day or changed items), ask the Edge Function to send pushes.
-- The URL points at the live project; change it if the database is rebuilt under a new project ref.
create or replace function purchases_private.notify_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  if tg_op = 'UPDATE' and new.items = old.items then return new; end if;
  select hook_secret into secret from purchases_private.push_config where id;
  if secret is null then return new; end if;
  perform net.http_post(
    url := 'https://cqqeffacjibhkahbfjzu.supabase.co/functions/v1/purchases-notify',
    body := jsonb_build_object('day', new.day),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    timeout_milliseconds := 5000
  );
  return new;
end $$;

create trigger purchases_sessions_notify after insert or update on public.purchases_sessions
for each row execute function purchases_private.notify_session();
