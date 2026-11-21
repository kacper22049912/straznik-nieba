// Samoloty wojskowe z ADS-B (adsb.fi, zapasowo adsb.lol): tylko te, które same nadają pozycję.
// Myśliwce i samoloty bojowe zwykle mają wyłączone transpondery, więc ich tu nie zobaczymy.
const UA = "StraznikNieba/1.0 (+https://github.com/kacper22049912/straznik-nieba)";
const BOX = { s: 48.9, n: 55.1, w: 14, e: 24.3 };   // tylko niebo nad Polską (dokładny obrys sprawdza aplikacja)
async function get(url) { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json() }
export async function fetchMil(prev, allowBackup) {
  // adsb.fi odrzuca zapytania z serwerów Cloudflare (403), więc najpierw adsb.lol
  let j, src = "adsb.lol", errs = [];
  for (const [name, url] of [["adsb.lol", "https://api.adsb.lol/v2/mil"], ["adsb.fi", "https://opendata.adsb.fi/api/v2/mil"]]) {
    try { j = await get(url); src = name; break } catch (e) { errs.push(name + ": " + e.message) }
  }
  if (!j) throw new Error(errs.join("; "));
  const now = Date.now(), ac = [];
  for (const a of j.ac || []) {
    if (a.lat == null || a.lon == null || a.alt_baro === "ground") continue;
    if (a.lat < BOX.s || a.lat > BOX.n || a.lon < BOX.w || a.lon > BOX.e) continue;
    if ((a.seen_pos ?? 0) > 120) continue;
    ac.push({ h: a.hex, cs: String(a.flight || "").trim(), t: a.t || "", d: a.desc || "", r: a.r || "", alt: typeof a.alt_baro === "number" ? a.alt_baro : null, gs: a.gs ?? null, trk: a.track ?? null, lat: +a.lat.toFixed(4), lon: +a.lon.toFixed(4), sq: a.squawk || "", ts: now - Math.round((a.seen_pos || 0) * 1000) });
  }
  // ślady: ostatnie 45 min, punkt co ≥30 s lub ≥2 km
  const trails = {}, old = (prev && prev.trails) || {};
  for (const a of ac) {
    const tr = (old[a.h] || []).filter(p => p[0] > now - 45 * 60000), l = tr[tr.length - 1];
    if (!l || now - l[0] >= 30000 || Math.hypot(l[1] - a.lat, (l[2] - a.lon) * .65) > .018) tr.push([now, a.lat, a.lon]);
    trails[a.h] = tr.slice(-120);
  }
  return { t: now, src, ac, trails };
}

// Prawdziwe zdjęcia konkretnego egzemplarza z Planespotters.net (po kodzie transpondera, zapasowo po rejestracji).
// Wynik zapamiętujemy w D1: znalezione zdjęcie 30 dni, brak zdjęcia 2 dni. Najwyżej 5 nowych zapytań na minutę.
async function lookupPhoto(a) {
  for (const url of [`https://api.planespotters.net/pub/photos/hex/${a.h}`, a.r ? `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(a.r)}` : null].filter(Boolean)) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) continue;
      const p = ((await r.json()).photos || [])[0];
      if (p) return { src: (p.thumbnail_large || p.thumbnail || {}).src, link: p.link, by: p.photographer };
    } catch (e) { }
  }
  return null;
}
export async function attachPhotos(env, m) {
  let budget = 5; const now = Date.now();
  for (const a of m.ac) {
    const row = await env.DB.prepare("SELECT v, t FROM photo WHERE h=?").bind(a.h).first();
    if (row) { const v = JSON.parse(row.v); if (v || now - row.t < 2 * 864e5) { a.ph = v; continue } }
    if (budget-- <= 0) continue;
    const v = await lookupPhoto(a); a.ph = v;
    await env.DB.prepare("INSERT OR REPLACE INTO photo(h, v, t) VALUES(?,?,?)").bind(a.h, JSON.stringify(v), now).run();
  }
  return m;
}
