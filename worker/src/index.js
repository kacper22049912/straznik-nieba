// Strażnik Nieba – worker w tle.
// Co minutę: pobiera zagrożenia i alarmy z NEPTUN, zapisuje migawkę do osi czasu,
// sprawdza, czy coś zbliża się do Polski, i wysyła powiadomienia push.
// Push jest wysyłany bez treści (bez szyfrowania payloadu); service worker na telefonie
// po otrzymaniu sygnału pobiera treść z /api/inbox i pokazuje powiadomienie.
import { PL } from "./pl.js";

const API = "https://neptun.in.ua";
const UA = "StraznikNieba/1.0 (+https://kacper22049912.github.io/straznik-nieba/)";
const BORDER_OBL = ["Волинська область", "Львівська область", "Закарпатська область"];
const TYPE_PL = {
  uav: "Dron uderzeniowy", recon: "Dron rozpoznawczy", missile: "Pocisk manewrujący",
  ballistic: "Pocisk balistyczny", kab: "Bomba szybująca KAB", mig31k: "MiG-31K w powietrzu", unknown: "Nieznany obiekt",
};
const CITIES = [["Warszawa", 52.23, 21.01], ["Lublin", 51.25, 22.57], ["Rzeszów", 50.04, 22.0], ["Białystok", 53.13, 23.16], ["Zamość", 50.72, 23.25],
  ["Chełm", 51.14, 23.47], ["Hrubieszów", 50.81, 23.89], ["Przemyśl", 49.78, 22.77], ["Biała Podlaska", 52.03, 23.12], ["Suwałki", 54.1, 22.93],
  ["Włodawa", 51.55, 23.55], ["Tomaszów Lubelski", 50.45, 23.42], ["Krosno", 49.69, 21.77], ["Sanok", 49.56, 22.2], ["Ustrzyki Dolne", 49.43, 22.59],
  ["Kraków", 50.06, 19.94], ["Olsztyn", 53.78, 20.49], ["Kielce", 50.87, 20.63], ["Gdańsk", 54.35, 18.65]];

/* ---------- geometria ---------- */
const R = Math.PI / 180;
const km = (a, b) => Math.hypot((b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * R) * 111.32, (b[0] - a[0]) * 110.57);
const move = (p, brg, d) => [p[0] + d * Math.cos(brg * R) / 110.57, p[1] + d * Math.sin(brg * R) / (111.32 * Math.cos(p[0] * R))];
function inRing(p, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1]) c = !c } return c }
const inPL = p => p[0] > 48.9 && p[0] < 54.95 && p[1] > 14.0 && p[1] < 24.2 && PL.some(r => inRing(p, r));
const PLPTS = PL.flat();
function distPL(p) { if (inPL(p)) return 0; let m = 1e9; for (const q of PLPTS) { const d = km(p, q); if (d < m) m = d } return m }
function towardPL(p, hdg) { if (hdg == null) return null; for (let d = 10; d <= 300; d += 10) if (inPL(move(p, hdg, d))) return d; return null }
function nearestCity(p) { let b = CITIES[0], m = 1e9; for (const c of CITIES) { const d = km(p, [c[1], c[2]]); if (d < m) { m = d; b = c } } return b[0] }
function predict(t, now) {
  const p = [t.lat, t.lon];
  if (t.areaOnly || !t.velocity || !t.velocity.speedKmh) return { pos: p, hdg: t.heading ?? null, speed: null };
  const t0 = Date.parse(t.confirmedAt || t.updatedAt);
  const h = Math.min(15, Math.max(0, (now - t0) / 60000)) / 60;
  const b = t.velocity.bearingDeg ?? t.heading;
  return { pos: b == null ? p : move(p, b, t.velocity.speedKmh * h), hdg: b ?? null, speed: t.velocity.speedKmh };
}

/* ---------- base64url / VAPID ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = s => b64u(new TextEncoder().encode(s));
async function vapid(env) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k='vapid'").first();
  if (row) return JSON.parse(row.v);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const v = { pub, jwk };
  await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES('vapid',?)").bind(JSON.stringify(v)).run();
  return JSON.parse((await env.DB.prepare("SELECT v FROM kv WHERE k='vapid'").first()).v);
}
async function sendPush(sub, keys, env) {
  const aud = new URL(sub.endpoint).origin;
  const head = b64uStr(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64uStr(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.CONTACT || "https://kacper22049912.github.io/straznik-nieba/" }));
  const key = await crypto.subtle.importKey("jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + body));
  const jwt = head + "." + body + "." + b64u(sig);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { TTL: "3600", Urgency: "high", Authorization: `vapid t=${jwt}, k=${keys.pub}`, "Content-Length": "0" } });
  return r.status;
}

/* ---------- baza ---------- */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)",
  "CREATE TABLE IF NOT EXISTS subs(id TEXT PRIMARY KEY, endpoint TEXT UNIQUE, sub TEXT, prefs TEXT, created INTEGER, last_ok INTEGER)",
  "CREATE TABLE IF NOT EXISTS sent(sub_id TEXT, key TEXT, t INTEGER, PRIMARY KEY(sub_id,key))",
  "CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, sub_id TEXT, t INTEGER, msg TEXT)",
  "CREATE TABLE IF NOT EXISTS snaps(t INTEGER PRIMARY KEY, d TEXT)",
  "CREATE TABLE IF NOT EXISTS alerts_log(t INTEGER PRIMARY KEY, d TEXT)",
  "CREATE INDEX IF NOT EXISTS inbox_sub ON inbox(sub_id)",
];
let schemaReady = false;
async function ensureSchema(env) { if (schemaReady) return; await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); schemaReady = true }
async function subId(endpoint) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)); return b64u(h).slice(0, 22) }
const DEFAULT_PREFS = { thr: 100, inPL: true, near: true, toward: true, border: true };

/* ---------- pobieranie z NEPTUN ---------- */
async function neptun(env, path) {
  const r = await fetch((env.NEPTUN_BASE || API) + path, { headers: { "User-Agent": UA, Accept: "application/json" }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(path + " HTTP " + r.status);
  return r.json();
}

/* ---------- zadanie co minutę ---------- */
async function tick(env) {
  await ensureSchema(env);
  const now = Date.now(), t = Math.floor(now / 60000) * 60000;
  const [th, al, ms] = await Promise.all([neptun(env, "/api/v1/threats"), neptun(env, "/api/v1/alerts").catch(() => null), neptun(env, "/api/v1/messages").catch(() => null)]);
  const threats = th.threats || [];
  const stmts = [];
  if (ms && Array.isArray(ms.messages)) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('msgs',?)").bind(JSON.stringify({ t: now, messages: ms.messages.slice(0, 40) })));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('status',?)").bind(JSON.stringify({ lastRun: now, ok: true, threats: threats.length })));

  // migawka do osi czasu: [id, typ, lat, lon, kurs, liczba, flagi, miejsce]
  const rows = threats.filter(x => x.status !== "resolved").map(x => [x.id, x.type, +(+x.lat).toFixed(3), +(+x.lon).toFixed(3), x.heading ?? null, x.count || 0,
    (x.areaOnly ? 1 : 0) | (x.advisory ? 2 : 0) | (x.status === "stale" ? 4 : 0), x.locality || x.region || ""]);
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO snaps(t,d) VALUES(?,?)").bind(t, JSON.stringify(rows)));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('live',?)").bind(JSON.stringify({ t: now, threats, alerts: al })));

  // alarmy: zapis tylko przy zmianie
  let borderNow = [];
  if (al) {
    borderNow = [...(al.raions || []), ...(al.oblasts || [])].filter(a => BORDER_OBL.includes(a.oblast) || BORDER_OBL.includes(a.name));
    const compact = { r: (al.raions || []).map(a => a.key).sort(), o: (al.oblasts || []).map(a => a.key).sort(), b: borderNow.map(a => a.name).sort() };
    const s = JSON.stringify(compact);
    const prev = await env.DB.prepare("SELECT d FROM alerts_log ORDER BY t DESC LIMIT 1").first();
    if (!prev || prev.d !== s) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO alerts_log(t,d) VALUES(?,?)").bind(t, s));
  }

  // fakty o obiektach z pozycją
  const facts = [];
  for (const x of threats) {
    if (x.areaOnly || x.advisory || x.status === "resolved" || x.status === "stale" || x.lat == null) continue;
    const p = predict(x, now);
    // szybki odsiew: dalej niż ~900 km od Polski nie liczymy dokładnie
    if (km(p.pos, [51.9, 19.1]) > 1250) continue;
    const dist = distPL(p.pos);
    facts.push({ x, pos: p.pos, hdg: p.hdg, speed: p.speed, dist, inPL: dist === 0, toPL: towardPL(p.pos, p.hdg) });
  }

  const subs = (await env.DB.prepare("SELECT id, sub, prefs FROM subs").all()).results || [];
  if (subs.length && (facts.length || borderNow.length)) {
    const sentRows = (await env.DB.prepare("SELECT sub_id, key FROM sent WHERE t > ?").bind(now - 12 * 3600e3).all()).results || [];
    const sent = new Set(sentRows.map(r => r.sub_id + "|" + r.key));
    const keys = await vapid(env);
    for (const s of subs) {
      const prefs = { ...DEFAULT_PREFS, ...JSON.parse(s.prefs || "{}") };
      const msgs = [];
      const once = (key, msg) => { if (!sent.has(s.id + "|" + key)) { sent.add(s.id + "|" + key); msgs.push(msg); stmts.push(env.DB.prepare("INSERT OR REPLACE INTO sent(sub_id,key,t) VALUES(?,?,?)").bind(s.id, key, now)) } };
      for (const f of facts) {
        const name = TYPE_PL[f.x.type] || TYPE_PL.unknown, cnt = f.x.count > 1 ? ` ×${f.x.count}` : "";
        const where = [f.x.locality, f.x.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
        if (f.inPL && prefs.inPL) once("in:" + f.x.id, { title: `🚨 ${name}${cnt} nad Polską`, body: `Okolice m. ${nearestCity(f.pos)}. Słuchaj komunikatów RCB.`, tag: "in-" + f.x.id, level: 2, ll: f.pos });
        else if (f.dist < prefs.thr && prefs.near) once("near" + prefs.thr + ":" + f.x.id, { title: `⚠️ ${name}${cnt} ${Math.round(f.dist)} km od granicy`, body: `${where}${f.toPL ? ". Kurs w stronę Polski" : ""}${f.speed ? `, ${Math.round(f.speed)} km/h` : ""}.`, tag: "near-" + f.x.id, level: f.toPL ? 2 : 1, ll: f.pos });
        else if (f.toPL && f.dist < prefs.thr * 2 && prefs.toward) once("tow:" + f.x.id, { title: `↗ ${name}${cnt} leci w stronę Polski`, body: `${where}, ${Math.round(f.dist)} km od granicy.`, tag: "tow-" + f.x.id, level: 1, ll: f.pos });
      }
      if (prefs.border) for (const a of borderNow) once("al:" + a.key + ":" + a.since, { title: "🔴 Alarm lotniczy przy granicy RP", body: `${a.name}${a.oblast && a.oblast !== a.name ? " (" + a.oblast + ")" : ""}`, tag: "al-" + a.key, level: 1 });
      if (!msgs.length) continue;
      for (const m of msgs) stmts.push(env.DB.prepare("INSERT INTO inbox(sub_id,t,msg) VALUES(?,?,?)").bind(s.id, now, JSON.stringify(m)));
      try {
        const st = await sendPush(JSON.parse(s.sub), keys, env);
        if (st === 404 || st === 410) stmts.push(env.DB.prepare("DELETE FROM subs WHERE id=?").bind(s.id));
        else if (st < 300) stmts.push(env.DB.prepare("UPDATE subs SET last_ok=? WHERE id=?").bind(now, s.id));
      } catch (e) { /* nieudany push nie zatrzymuje reszty */ }
    }
  }

  // sprzątanie raz na godzinę
  if (new Date(t).getUTCMinutes() === 0) {
    stmts.push(env.DB.prepare("DELETE FROM snaps WHERE t < ?").bind(now - 48 * 3600e3));
    stmts.push(env.DB.prepare("DELETE FROM alerts_log WHERE t < ? AND t <> (SELECT MAX(t) FROM alerts_log)").bind(now - 48 * 3600e3));
    stmts.push(env.DB.prepare("DELETE FROM sent WHERE t < ?").bind(now - 12 * 3600e3));
    stmts.push(env.DB.prepare("DELETE FROM inbox WHERE t < ?").bind(now - 3600e3));
  }
  await env.DB.batch(stmts);
}

/* ---------- HTTP ---------- */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (d, s = 200, extra = {}) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });
async function body(req) { try { return await req.json() } catch { return {} } }
function cleanPrefs(p = {}) {
  const thr = [25, 50, 100, 150, 250].includes(+p.thr) ? +p.thr : 100;
  return { thr, inPL: p.inPL !== false, near: p.near !== false, toward: p.toward !== false, border: p.border !== false };
}

async function handle(req, env) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  await ensureSchema(env);
  const url = new URL(req.url), path = url.pathname;

  if (path === "/api/vapid") return json({ key: (await vapid(env)).pub });

  if (path === "/api/live") {
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k='live'").first();
    return json(row ? JSON.parse(row.v) : { t: 0, threats: [], alerts: null }, 200, { "Cache-Control": "public, max-age=10" });
  }

  if (path === "/api/history") {
    const hours = Math.min(24, Math.max(1, +url.searchParams.get("hours") || 6));
    const step = Math.min(10, Math.max(1, +url.searchParams.get("step") || 1));
    const since = Date.now() - hours * 3600e3;
    const snaps = ((await env.DB.prepare("SELECT t, d FROM snaps WHERE t >= ? ORDER BY t").bind(since).all()).results || [])
      .filter((r, i) => i % step === 0).map(r => [r.t, JSON.parse(r.d)]);
    const alerts = ((await env.DB.prepare("SELECT t, d FROM alerts_log WHERE t >= (SELECT COALESCE(MAX(t),0) FROM alerts_log WHERE t <= ?) ORDER BY t").bind(since).all()).results || [])
      .map(r => [r.t, JSON.parse(r.d)]);
    return json({ snaps, alerts }, 200, { "Cache-Control": "public, max-age=30" });
  }

  if (path === "/api/status") {
    const last = await env.DB.prepare("SELECT MAX(t) AS t, COUNT(*) AS n FROM snaps").first();
    const st = await env.DB.prepare("SELECT v FROM kv WHERE k='status'").first();
    return json({ ok: true, now: Date.now(), lastSnapshot: last && last.t, snapshots: last && last.n, ...(st ? JSON.parse(st.v) : {}) });
  }
  if (path === "/api/messages") {
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k='msgs'").first();
    return json(row ? JSON.parse(row.v) : { t: 0, messages: [] }, 200, { "Cache-Control": "public, max-age=15" });
  }

  if (!path.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Nie znaleziono", { status: 404 });
  if (req.method !== "POST") return json({ error: "Nie znaleziono" }, 404);
  const b = await body(req);

  if (path === "/api/subscribe") {
    const s = b.subscription;
    if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return json({ error: "Nieprawidłowa subskrypcja" }, 400);
    const id = await subId(s.endpoint), prefs = cleanPrefs(b.prefs);
    await env.DB.prepare("INSERT INTO subs(id,endpoint,sub,prefs,created,last_ok) VALUES(?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET sub=excluded.sub, prefs=excluded.prefs")
      .bind(id, s.endpoint, JSON.stringify({ endpoint: s.endpoint, keys: s.keys || {} }), JSON.stringify(prefs), Date.now()).run();
    return json({ ok: true, prefs });
  }
  if (path === "/api/unsubscribe") {
    if (typeof b.endpoint === "string") { const id = await subId(b.endpoint); await env.DB.batch([env.DB.prepare("DELETE FROM subs WHERE id=?").bind(id), env.DB.prepare("DELETE FROM inbox WHERE sub_id=?").bind(id)]) }
    return json({ ok: true });
  }
  if (path === "/api/inbox") {
    if (typeof b.endpoint !== "string") return json({ msgs: [] });
    const id = await subId(b.endpoint);
    const rows = (await env.DB.prepare("SELECT id, msg FROM inbox WHERE sub_id=? ORDER BY id").bind(id).all()).results || [];
    if (rows.length) await env.DB.prepare("DELETE FROM inbox WHERE sub_id=? AND id <= ?").bind(id, rows[rows.length - 1].id).run();
    return json({ msgs: rows.map(r => JSON.parse(r.msg)) });
  }
  if (path === "/api/test") {
    if (typeof b.endpoint !== "string") return json({ error: "Brak subskrypcji" }, 400);
    const id = await subId(b.endpoint);
    const s = await env.DB.prepare("SELECT sub FROM subs WHERE id=?").bind(id).first();
    if (!s) return json({ error: "To urządzenie nie jest zapisane" }, 404);
    await env.DB.prepare("INSERT INTO inbox(sub_id,t,msg) VALUES(?,?,?)").bind(id, Date.now(), JSON.stringify({ title: "✅ Powiadomienia działają", body: "Strażnik Nieba będzie Cię ostrzegał także przy zamkniętej aplikacji.", tag: "test", level: 0 })).run();
    const st = await sendPush(JSON.parse(s.sub), await vapid(env), env);
    return json({ ok: st < 300, status: st }, st < 300 ? 200 : 502);
  }
  return json({ error: "Nie znaleziono" }, 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env) } catch (e) { return json({ error: "Błąd serwera", detail: String(e && e.message || e) }, 500) }
  },
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(tick(env).catch(async e => {
      // zapamiętaj błąd, żeby aplikacja mogła pokazać, dlaczego historia się nie zapisuje
      try { await ensureSchema(env); await env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('status',?)").bind(JSON.stringify({ lastRun: Date.now(), ok: false, error: String(e && e.message || e).slice(0, 300) })).run() } catch (_) { }
    }))
  },
};
