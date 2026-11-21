// Miejsca schronienia w pobliżu punktu, z OpenStreetMap (Overpass API).
// Schrony i bunkry oznaczone w OSM oraz miejsca doraźnego schronienia według PSP:
// stacje metra, parkingi podziemne, przejścia podziemne. Wynik w pamięci podręcznej na dobę.
const EPS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const R = 3000;

function query(lat, lon) {
  const a = `(around:${R},${lat},${lon})`;
  return `[out:json][timeout:10];(
nwr${a}["amenity"="shelter"]["shelter_type"~"bomb|air_raid|civil|underground",i];
nwr${a}["air_raid_shelter"="yes"];
nwr${a}["emergency"~"^(shelter|air_raid_shelter)$"];
nwr${a}["building"="bunker"][!"historic"][!"ruins"][!"disused"];
nwr${a}["railway"="station"]["station"="subway"];
nwr${a}["amenity"="parking"]["parking"="underground"];
way${a}["highway"~"footway|pedestrian"]["tunnel"="yes"]["layer"~"^-"];
);out center tags 400;`;
}

function kind(t) {
  if (/bomb|air_raid|civil/i.test(t.shelter_type || "") || t.air_raid_shelter === "yes" || /shelter/.test(t.emergency || "")) return "schron";
  if (t.building === "bunker") return "bunkier";
  if (t.station === "subway") return "metro";
  if (t.parking === "underground") return "parking";
  if (t.tunnel === "yes") return "przejście";
  return "inne";
}
const RANK = { schron: 0, bunkier: 1, metro: 2, przejście: 3, parking: 4, inne: 5 };
const dist = (a, b, c, d) => { const R0 = Math.PI / 180, x = (d - b) * Math.cos((a + c) / 2 * R0) * 111.32, y = (c - a) * 110.57; return Math.hypot(x, y) };

export async function shelters(lat, lon) {
  let data = null; const errs = [];
  for (const ep of EPS) {
    try {
      const r = await fetch(ep, { method: "POST", signal: AbortSignal.timeout(12000), body: "data=" + encodeURIComponent(query(lat, lon)), headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "StraznikNieba/1.0 (+https://github.com/kacper22049912/straznik-nieba)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = await r.json(); break;
    } catch (e) { errs.push(ep.split("/")[2] + ": " + (e.name === "TimeoutError" ? "przekroczony czas" : String(e.message || e))) }
  }
  if (!data) throw new Error(errs.join("; ") || "Overpass niedostępny");
  const seen = new Set(), out = [];
  for (const e of data.elements || []) {
    const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon); if (la == null) continue;
    const t = e.tags || {}, k = kind(t);
    if (t.access === "private" || t.access === "no") continue;
    const name = t.name || t["name:pl"] || t.operator || "";
    const key = k + ":" + (name || (la.toFixed(4) + lo.toFixed(4))); if (k === "metro" && seen.has(key)) continue; seen.add(key);
    out.push({ k, name, lat: +la.toFixed(5), lon: +lo.toFixed(5), d: +dist(lat, lon, la, lo).toFixed(2), cap: t.capacity ? +t.capacity || null : null, lvl: t.level || t.layer || null, osm: e.type + "/" + e.id });
  }
  out.sort((a, b) => (a.d + RANK[a.k] * .25) - (b.d + RANK[b.k] * .25));
  return { t: Date.now(), r: R, items: out.slice(0, 40) };
}

export async function overpassDebug() {
  const out = {};
  for (const ep of EPS) {
    const t0 = Date.now();
    try { const r = await fetch(ep.replace("interpreter", "status"), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "StraznikNieba/1.0" } }); out[ep] = r.status + " " + (await r.text()).slice(0, 200) + " " + (Date.now() - t0) + "ms" }
    catch (e) { out[ep] = "ERR " + (e.name || "") + " " + (e.message || e) + " " + (Date.now() - t0) + "ms" }
    const t1 = Date.now();
    try { const r = await fetch(ep + "?data=" + encodeURIComponent("[out:json][timeout:5];node(52.229,21.01,52.231,21.012);out 1;"), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "StraznikNieba/1.0" } }); out[ep + " GET"] = r.status + " " + (await r.text()).slice(0, 120) + " " + (Date.now() - t1) + "ms" }
    catch (e) { out[ep + " GET"] = "ERR " + (e.name || "") + " " + (e.message || e) + " " + (Date.now() - t1) + "ms" }
  }
  return out;
}
