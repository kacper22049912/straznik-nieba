/* Strażnik Nieba: service worker.
   - push: serwer wysyła pusty sygnał; tu pobieramy treść z /api/inbox i pokazujemy powiadomienie,
   - kliknięcie powiadomienia otwiera aplikację,
   - pamięć podręczna pozwala otworzyć aplikację bez sieci (dane i tak wymagają internetu). */
importScripts("config.js");
const WORKER = ((self.SN_CONFIG || {}).worker || "").replace(/\/+$/, "");
const CACHE = "sn-v13";
const SHELL = ["./", "index.html", "app.js", "geo.js", "ua.js", "leaflet.css", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/badge.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting() });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // najpierw sieć (zawsze świeża wersja), pamięć tylko awaryjnie
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)).catch(() => {}); return r }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let msgs = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub && WORKER) {
        const r = await fetch(WORKER + "/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        msgs = (await r.json()).msgs || [];
      }
    } catch (err) { }
    if (!msgs.length) msgs = [{ title: "Strażnik Nieba", body: "Nowe ostrzeżenie. Otwórz aplikację, aby zobaczyć szczegóły.", tag: "sn", level: 1 }];
    if (msgs.length > 4) { const rest = msgs.length - 3; msgs = msgs.slice(0, 3).concat([{ title: `Strażnik Nieba: jeszcze ${rest} ostrzeżeń`, body: "Otwórz aplikację, aby zobaczyć wszystkie.", tag: "sn-more", level: 1 }]) }
    for (const m of msgs) {
      await self.registration.showNotification(m.title, {
        body: m.body, tag: m.tag || "sn", renotify: true, icon: "icons/icon-192.png", badge: "icons/badge.png",
        requireInteraction: m.level >= 2, vibrate: m.level >= 2 ? [500, 150, 500, 150, 900] : [250, 100, 250],
        data: { url: "./" }
      });
    }
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  })());
});
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    if (!WORKER) return;
    const { key } = await (await fetch(WORKER + "/api/vapid")).json();
    const p = "=".repeat((4 - key.length % 4) % 4), raw = atob((key + p).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    await fetch(WORKER + "/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), prefs: {} }) });
  })());
});
