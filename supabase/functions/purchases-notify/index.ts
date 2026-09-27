// Sends a Web Push to every subscribed device (except the one that saved) when a day's list is confirmed.
// Called by the purchases_sessions_notify trigger via pg_net. Keys live in purchases_private.push_config.
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import webpush from "npm:web-push@3.6.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });

function fmt(q: number) { return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }

Deno.serve(async (req) => {
  const [cfg] = await sql`select vapid_public, vapid_private, subject, hook_secret from purchases_private.push_config where id`;
  if (!cfg || req.headers.get("x-hook-secret") !== cfg.hook_secret) return new Response("forbidden", { status: 403 });

  const { day } = await req.json().catch(() => ({}));
  const [s] = await sql`select s.day::text as day, s.items, s.saved_by, p.name as who
    from public.purchases_sessions s left join public.purchases_profiles p on p.id = s.saved_by_profile where s.day = ${day}`;
  if (!s) return new Response("no session", { status: 200 });

  const items = (s.items as { item_id: string; qty: number; unit: string }[]) || [];
  const names = new Map<string, string>();
  if (items.length) (await sql`select id, name from public.purchases_items where id = any(${items.map(i => i.item_id)})`).forEach(r => names.set(r.id, r.name));
  const [y, m, d] = s.day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const list = items.slice(0, 3).map(i => `${names.get(i.item_id) ?? i.item_id} (${fmt(Number(i.qty))} ${i.unit})`).join(", ");
  const body = items.length
    ? `${date} · ${items.length} ${items.length === 1 ? "item" : "items"}: ${list}${items.length > 3 ? ` +${items.length - 3} more` : ""}`
    : `${date} · list cleared`;
  const payload = JSON.stringify({ title: s.who ? `${s.who} saved the list` : "Purchases List updated", body, day: s.day });

  webpush.setVapidDetails(cfg.subject, cfg.vapid_public, cfg.vapid_private);
  const subs = await sql`select endpoint, p256dh, auth from purchases_private.push_subs where device_id is distinct from ${s.saved_by}`;
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
  return Response.json({ sent, removed, total: subs.length });
});
