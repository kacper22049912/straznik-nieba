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
