-- Detailed push notifications: "Mohammed added 3 items to your purchase list".
-- Every activity row (save, add_item, reset) pings the purchases-notify Edge Function, which waits for a quiet
-- moment, rolls everything that person did since their last notification into one message, and sends it to
-- every other subscribed device. Replaces the per-save push from purchases_sessions_notify.

-- Which profile owns each push subscription, so the person who made a change isn't notified about it.
alter table purchases_private.push_subs add column if not exists profile_id uuid;
update purchases_private.push_subs s set profile_id = x.saved_by_profile
  from (select distinct on (saved_by) saved_by, saved_by_profile from public.purchases_sessions
         where saved_by is not null and saved_by_profile is not null order by saved_by, updated_at desc) x
 where s.profile_id is null and s.device_id = x.saved_by;

-- Last activity id already announced per person (all-zero uuid = changes made without a profile).
create table if not exists purchases_private.push_sent (
  actor uuid primary key,
  last_id bigint not null,
  sent_at timestamptz not null default now()
);
insert into purchases_private.push_sent (actor, last_id)
select coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), max(id) from public.purchases_activity group by 1
on conflict (actor) do nothing;

-- Subscribe now also records the profile. The default keeps older cached copies of the app working.
drop function if exists public.purchases_push_subscribe(text, text, text, text);
create or replace function public.purchases_push_subscribe(sub_endpoint text, sub_p256dh text, sub_auth text, sub_device text, sub_profile uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if sub_endpoint !~ '^https://' then raise exception 'bad endpoint'; end if;
  if (select count(*) from purchases_private.push_subs) >= 100
     and not exists (select 1 from purchases_private.push_subs where endpoint = sub_endpoint) then
    raise exception 'too many subscriptions';
  end if;
  insert into purchases_private.push_subs (endpoint, p256dh, auth, device_id, profile_id)
  values (sub_endpoint, sub_p256dh, sub_auth, sub_device, sub_profile)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, device_id = excluded.device_id,
        profile_id = coalesce(excluded.profile_id, push_subs.profile_id), updated_at = now();
end $$;
revoke all on function public.purchases_push_subscribe(text, text, text, text, uuid) from public;
grant execute on function public.purchases_push_subscribe(text, text, text, text, uuid) to anon, authenticated;

-- Pushes now follow the activity log instead of each saved day.
drop trigger if exists purchases_sessions_notify on public.purchases_sessions;
drop function if exists purchases_private.notify_session();

create or replace function purchases_private.notify_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  select hook_secret into secret from purchases_private.push_config where id;
  if secret is null then return new; end if;
  perform net.http_post(
    url := 'https://cqqeffacjibhkahbfjzu.supabase.co/functions/v1/purchases-notify',
    body := jsonb_build_object('activity_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    timeout_milliseconds := 5000
  );
  return new;
end $$;

create trigger purchases_activity_notify after insert on public.purchases_activity
for each row execute function purchases_private.notify_activity();
