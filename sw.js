// Purchases List service worker: shows push notifications ("Mohammed added 3 items…") and keeps the app-icon badge count.
// No offline caching; the page always loads fresh from the network.
const META = "purchases-meta", BADGE = "/__badge-count";

async function getCount(){ const c = await caches.open(META); const r = await c.match(BADGE); return r ? Number(await r.text()) || 0 : 0; }
async function setCount(n){ const c = await caches.open(META); await c.put(BADGE, new Response(String(n))); }

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const n = (await getCount()) + 1; await setCount(n);
    if (self.navigator.setAppBadge) try { await self.navigator.setAppBadge(n); } catch (_) {}
    await self.registration.showNotification(d.title || "Purchases List updated", {
      body: d.body || "", icon: "/icon-192.png?v=basket", badge: "/favicon-64.png?v=basket",
      tag: d.tag || "purchases-" + (d.day || "update"), renotify: true, data: { url: d.url || "/" }
    });
  })());
});

// Opens the app on Activity so the person sees exactly what changed.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if ("focus" in w){
      if (url.endsWith("#activity")) w.postMessage({ open: "activity" });
      return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
