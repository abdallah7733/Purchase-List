// Sends a Web Push to every other subscribed device describing what someone changed, e.g.
// "Mohammed added 3 items to your purchase list". Called by the purchases_activity_notify trigger via pg_net
// with { activity_id }. Rapid edits are batched: each call waits for a quiet spell, and only the call for a
// person's latest activity sends, rolling up everything they did since their last notification.
// Keys live in purchases_private.push_config.
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import webpush from "npm:web-push@3.6.7";
import { buildMessage, type Activity } from "./message.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });

const QUIET_MS = 30_000;          // wait this long after a change for more changes from the same person
const MAX_WAIT_MS = 3 * 60_000;   // but never hold a notification longer than this while they keep editing
const LOOKBACK = "15 minutes";    // ignore anything older (a missed or first-ever batch never dumps old history)
const NO_PROFILE = "00000000-0000-0000-0000-000000000000";
const TZ = "Africa/Cairo";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(activityId: number) {
  await sleep(QUIET_MS);

  const [a] = await sql`select id, coalesce(profile_id, ${NO_PROFILE}::uuid) as actor, profile_id
    from public.purchases_activity where id = ${activityId}`;
  if (!a) return;

  // A newer change by the same person will send the batch, unless they've been at it too long already.
  const [state] = await sql`select max(id) as newest, min(at) filter (where id > coalesce(s.last_id, 0)) as oldest
    from public.purchases_activity
    left join purchases_private.push_sent s on s.actor = ${a.actor}::uuid
    where coalesce(profile_id, ${NO_PROFILE}::uuid) = ${a.actor}::uuid and at > now() - ${LOOKBACK}::interval`;
  const newest = Number(state.newest);
  if (newest > Number(a.id) && Date.now() - new Date(state.oldest).getTime() < MAX_WAIT_MS) return;

  // Claim the batch (previous watermark, newest] so overlapping calls never send it twice.
  const rows = await sql.begin(async (tx) => {
    await tx`insert into purchases_private.push_sent (actor, last_id) values (${a.actor}::uuid, 0) on conflict (actor) do nothing`;
    const [{ last_id }] = await tx`select last_id from purchases_private.push_sent where actor = ${a.actor}::uuid for update`;
    if (Number(last_id) >= newest) return [];
    await tx`update purchases_private.push_sent set last_id = ${newest}, sent_at = now() where actor = ${a.actor}::uuid`;
    return await tx`select id, kind, day::text as day, details from public.purchases_activity
      where coalesce(profile_id, ${NO_PROFILE}::uuid) = ${a.actor}::uuid and id > ${last_id} and id <= ${newest}
        and at > now() - ${LOOKBACK}::interval order by id`;
  });
  if (!rows.length) return;

  const ids = new Set<string>();
  for (const r of rows) for (const c of (r.details?.changes ?? [])) ids.add(c.item_id);
  const names = new Map<string, string>();
  if (ids.size) (await sql`select id, name from public.purchases_items where id = any(${[...ids]})`).forEach((r) => names.set(r.id, r.name));
  const [p] = a.profile_id ? await sql`select name from public.purchases_profiles where id = ${a.profile_id}` : [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  const msg = buildMessage(p?.name ?? null, rows as unknown as Activity[], names, today);
  if (!msg) return;
  const payload = JSON.stringify({ ...msg, tag: `purchases-${newest}`, url: "/#activity" });

  const [cfg] = await sql`select vapid_public, vapid_private, subject from purchases_private.push_config where id`;
  webpush.setVapidDetails(cfg.subject, cfg.vapid_public, cfg.vapid_private);
  // Skip the person who made the change: by profile, or for older subscriptions without one, by the devices they saved from.
  const subs = await sql`select endpoint, p256dh, auth from purchases_private.push_subs
    where ${a.profile_id}::uuid is null or (profile_id is distinct from ${a.profile_id}::uuid
      and (profile_id is not null or device_id is null or device_id not in (
        select saved_by from public.purchases_sessions where saved_by_profile = ${a.profile_id}::uuid and saved_by is not null)))`;
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400, urgency: "normal", topic: "purchases" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await sql`delete from purchases_private.push_subs where endpoint = ${sub.endpoint}`; removed++; }
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  console.log("notified", { actor: a.actor, through: newest, activities: rows.length, sent, removed, total: subs.length });
}

Deno.serve(async (req) => {
  const [cfg] = await sql`select hook_secret from purchases_private.push_config where id`;
  if (!cfg || req.headers.get("x-hook-secret") !== cfg.hook_secret) return new Response("forbidden", { status: 403 });

  const { activity_id } = await req.json().catch(() => ({}));
  const id = Number(activity_id);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("ignored", { status: 200 });   // e.g. the old { day } payload

  // Answer pg_net right away; the batching wait runs in the background.
  EdgeRuntime.waitUntil(handle(id).catch((e) => console.error("notify failed", (e as Error).message)));
  return new Response("queued", { status: 202 });
});
