// Strażnik Nieba – worker w tle.
// Co minutę: pobiera zagrożenia i alarmy z NEPTUN, zapisuje migawkę do osi czasu,
// sprawdza, czy coś zbliża się do Polski, i wysyła powiadomienia push.
// Push jest wysyłany bez treści (bez szyfrowania payloadu); service worker na telefonie
// po otrzymaniu sygnału pobiera treść z /api/inbox i pokazuje powiadomienie.
import { PL } from "./pl.js";
import { fetchRcb } from "./rcb.js";
import { fetchNews } from "./news.js";
import { translateMessages } from "./translate.js";
import { aggregateRows, addIncidents, readStats } from "./stats.js";
import { fetchMil } from "./mil.js";
import { plPlace, plRegion } from "./plnames.js";

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
const PLCOARSE = PLPTS.filter((_, i) => i % 8 === 0);
function roughPL(p) { if (inPL(p)) return 0; let m = 1e9; for (const q of PLCOARSE) { const d = km(p, q); if (d < m) m = d } return m }
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
  "CREATE TABLE IF NOT EXISTS tr(h TEXT PRIMARY KEY, pl TEXT, t INTEGER)",
  "CREATE TABLE IF NOT EXISTS geo(q TEXT PRIMARY KEY, v TEXT, t INTEGER)",
  "CREATE TABLE IF NOT EXISTS agg(day TEXT PRIMARY KEY, d TEXT)",
];
let schemaReady = false;
async function ensureSchema(env) { if (schemaReady) return; await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); schemaReady = true }
async function subId(endpoint) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)); return b64u(h).slice(0, 22) }
const DEFAULT_PREFS = { thr: 100, inPL: true, near: true, toward: true, border: true, rcb: true, news: true };

/* ---------- pobieranie z NEPTUN ---------- */
async function neptun(env, path) {
  const r = await fetch((env.NEPTUN_BASE || API) + path, { headers: { "User-Agent": UA, Accept: "application/json" }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(path + " HTTP " + r.status);
  return r.json();
}

/* ---------- zadanie co minutę ---------- */
const kvGet = async (env, k) => { const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); return r ? JSON.parse(r.v) : null };
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(k, JSON.stringify(v));

const HIST_MS = 12 * 3600e3;   // historia pozycji: 12 godzin
const compact = threats => threats.filter(x => x.status !== "resolved" && x.lat != null).map(x => [x.id, x.type, +(+x.lat).toFixed(3), +(+x.lon).toFixed(3), x.heading ?? null, x.count || 0,
  (x.areaOnly ? 1 : 0) | (x.advisory ? 2 : 0) | (x.status === "stale" ? 4 : 0), x.locality || x.region || ""]);
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

// Cron uruchamia worker raz na minutę; w środku pobieramy NEPTUN co 5 s (12 razy).
// Migawkę zapisujemy, gdy coś się zmieniło, i co najmniej raz na minutę.
async function run(env) {
  await ensureSchema(env);
  const start = Date.now(), st = { last: null, lastT: 0, al: null };
  const lastRow = await env.DB.prepare("SELECT t, d FROM snaps ORDER BY t DESC LIMIT 1").first();
  if (lastRow) { st.last = lastRow.d; st.lastT = lastRow.t }
  for (let i = 0; i < 12; i++) {
    await sleep(start + i * 5000 - Date.now());
    if (Date.now() - start > 57000) break;
    try { await poll(env, st, i) } catch (e) { st.err = String(e && e.message || e) }
    if (i === 0) { try { await minuteWork(env, st) } catch (e) { st.err = String(e && e.message || e) } }
    if (i === 6) { try { await milWork(env, false) } catch (e) { } }
  }
  await kvPut(env, "status", { lastRun: Date.now(), ok: !st.err, error: st.err || undefined, threats: st.threats ? st.threats.length : 0, interval: 5 }).run();
}

async function poll(env, st, i) {
  const now = Date.now();
  const [th, al] = await Promise.all([neptun(env, "/api/v1/threats"), i % 6 === 0 ? neptun(env, "/api/v1/alerts").catch(() => null) : Promise.resolve(null)]);
  st.threats = th.threats || []; if (al) st.al = al;
  const rows = compact(st.threats), d = JSON.stringify(rows), t = Math.round(now / 1000) * 1000;
  st.rows = rows;
  if (d !== st.last || t - st.lastT >= 60000) {
    const stmts = [env.DB.prepare("INSERT OR REPLACE INTO snaps(t,d) VALUES(?,?)").bind(t, d), kvPut(env, "live", { t: now, threats: st.threats, alerts: st.al })];
    await env.DB.batch(stmts); st.last = d; st.lastT = t;
  }
}

async function milWork(env, allowBackup) {
  try {
    const prev = await kvGet(env, "mil"), m = await fetchMil(prev, allowBackup);
    await kvPut(env, "mil", m).run();
  } catch (e) { await kvPut(env, "mil_err", { t: Date.now(), error: String(e && e.message || e) }).run().catch(() => { }) }
}

async function minuteWork(env, st) {
  const now = Date.now(), t = Math.floor(now / 60000) * 60000, minute = new Date(t).getUTCMinutes();
  const threats = st.threats || [], al = st.al;
  const core = [];
  let borderNow = [];
  if (al) {
    borderNow = [...(al.raions || []), ...(al.oblasts || [])].filter(a => BORDER_OBL.includes(a.oblast) || BORDER_OBL.includes(a.name));
    const c = JSON.stringify({ r: (al.raions || []).map(a => a.key).sort(), o: (al.oblasts || []).map(a => a.key).sort(), b: borderNow.map(a => a.name).sort() });
    const prev = await env.DB.prepare("SELECT d FROM alerts_log ORDER BY t DESC LIMIT 1").first();
    if (!prev || prev.d !== c) core.push(env.DB.prepare("INSERT OR REPLACE INTO alerts_log(t,d) VALUES(?,?)").bind(t, c));
  }
  if (minute % 10 === 0) core.push(
    env.DB.prepare("DELETE FROM snaps WHERE t < ?").bind(now - HIST_MS),
    env.DB.prepare("DELETE FROM alerts_log WHERE t < ? AND t <> (SELECT MAX(t) FROM alerts_log)").bind(now - HIST_MS),
    env.DB.prepare("DELETE FROM agg WHERE day < ?").bind(new Date(now - 90 * 864e5).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM sent WHERE t < ?").bind(now - 12 * 3600e3),
    env.DB.prepare("DELETE FROM inbox WHERE t < ?").bind(now - 3600e3),
    env.DB.prepare("DELETE FROM tr WHERE t < ?").bind(now - 2 * 864e5),
    env.DB.prepare("DELETE FROM kv WHERE k='airports' OR k='aggCursor'"));
  if (core.length) await env.DB.batch(core);

  // statystyki dzienne z bieżącej migawki
  try { await aggregateRows(env, t, st.rows || [], distPL, roughPL) } catch (e) { }
  // samoloty wojskowe (drugi raz w 30. sekundzie)
  try { await milWork(env, minute % 3 === 0) } catch (e) { }

  const notes = [];
  // wiadomości z kanałów: tłumaczenie na polski (więcej, gdy ktoś ogląda aplikację)
  try {
    const ms = await neptun(env, "/api/v1/messages");
    if (ms && Array.isArray(ms.messages)) {
      const seen = await kvGet(env, "seen"), watching = seen && now - seen.t < 20 * 60000;
      let tr = ms.messages.slice(0, 30);
      try { tr = await translateMessages(env, tr, watching ? 30 : 6) } catch (e) { }
      await kvPut(env, "msgs", { t: now, messages: tr }).run();
    }
  } catch (e) { }
  if (minute % 2 === 0) {
    try {
      const prev = await kvGet(env, "rcb"), rcb = await fetchRcb(prev); await kvPut(env, "rcb", rcb).run();
      const today = new Date().toISOString().slice(0, 10);
      for (const it of rcb.items) {
        if (it.date !== today || !it.updates.length) continue;
        const u = it.updates.find(x => x.time) || it.updates[0];
        notes.push({ key: "rcb:" + it.id + ":" + (u.time || "0"), pref: "rcb", msg: { title: (u.level === 2 ? "🚨 " : "📢 ") + it.title, body: (u.text || "") + (u.voiv.length ? " Woj.: " + u.voiv.join(", ") + "." : ""), tag: "rcb-" + it.id, level: u.level } });
      }
    } catch (e) { await kvPut(env, "rcb_err", { t: now, error: String(e.message || e) }).run().catch(() => { }) }
  }
  if (minute % 3 === 1) {
    try {
      const prev = await kvGet(env, "news"), news = await fetchNews(prev, env); delete news.all;
      await kvPut(env, "news", news).run();
      try { await addIncidents(env, news.items) } catch (e) { }
      for (const n of news.items) if (n.t > now - 3 * 3600e3 && n.impact) notes.push({ key: "news:" + n.id, pref: "news", msg: { title: "📰 " + n.title, body: `${n.src}${n.place ? " · " + n.place.name : ""}. Doniesienie mediów.`, tag: "news-" + n.id, level: 1, ll: n.place ? [n.place.lat, n.place.lon] : null } });
    } catch (e) { }
  }

  // powiadomienia push
  const facts = [];
  for (const x of threats) {
    if (x.areaOnly || x.advisory || x.status === "resolved" || x.status === "stale" || x.lat == null) continue;
    const p = predict(x, now);
    if (km(p.pos, [51.9, 19.1]) > 1250) continue;
    const dist = distPL(p.pos);
    facts.push({ x, pos: p.pos, hdg: p.hdg, speed: p.speed, dist, inPL: dist === 0, toPL: towardPL(p.pos, p.hdg) });
  }
  const subs = (await env.DB.prepare("SELECT id, sub, prefs FROM subs").all()).results || [];
  if (!subs.length || !(facts.length || borderNow.length || notes.length)) return;
  const stmts = [];
  const sentRows = (await env.DB.prepare("SELECT sub_id, key FROM sent WHERE t > ?").bind(now - 12 * 3600e3).all()).results || [];
  const sent = new Set(sentRows.map(r => r.sub_id + "|" + r.key));
  const keys = await vapid(env);
  for (const s of subs) {
    const prefs = { ...DEFAULT_PREFS, ...JSON.parse(s.prefs || "{}") };
    const msgs = [];
    const once = (key, msg) => { if (!sent.has(s.id + "|" + key)) { sent.add(s.id + "|" + key); msgs.push(msg); stmts.push(env.DB.prepare("INSERT OR REPLACE INTO sent(sub_id,key,t) VALUES(?,?,?)").bind(s.id, key, now)) } };
    for (const f of facts) {
      const name = TYPE_PL[f.x.type] || TYPE_PL.unknown, cnt = f.x.count > 1 ? ` ×${f.x.count}` : "";
      const where = plPlace(f.x);
      if (f.inPL && prefs.inPL) once("in:" + f.x.id, { title: `🚨 ${name}${cnt} nad Polską`, body: `Okolice m. ${nearestCity(f.pos)}. Słuchaj komunikatów RCB.`, tag: "in-" + f.x.id, level: 2, ll: f.pos });
      else if (f.dist < prefs.thr && prefs.near) once("near" + prefs.thr + ":" + f.x.id, { title: `⚠️ ${name}${cnt} ${Math.round(f.dist)} km od granicy`, body: `${where}${f.toPL ? ". Kurs w stronę Polski" : ""}${f.speed ? `, ${Math.round(f.speed)} km/h` : ""}.`, tag: "near-" + f.x.id, level: f.toPL ? 2 : 1, ll: f.pos });
      else if (f.toPL && f.dist < prefs.thr * 2 && prefs.toward) once("tow:" + f.x.id, { title: `↗ ${name}${cnt} leci w stronę Polski`, body: `${where}, ${Math.round(f.dist)} km od granicy.`, tag: "tow-" + f.x.id, level: 1, ll: f.pos });
    }
    if (prefs.border) for (const a of borderNow) once("al:" + a.key + ":" + a.since, { title: "🔴 Alarm lotniczy przy granicy RP", body: `${plRegion(a.oblast || a.name)}${a.oblast && a.oblast !== a.name ? " · rejon " + a.name.replace(/ район$/, "") : ""}`, tag: "al-" + a.key, level: 1 });
    for (const n of notes) if (prefs[n.pref] !== false) once(n.key, n.msg);
    if (!msgs.length) continue;
    for (const m of msgs) stmts.push(env.DB.prepare("INSERT INTO inbox(sub_id,t,msg) VALUES(?,?,?)").bind(s.id, now, JSON.stringify(m)));
    try {
      const code = await sendPush(JSON.parse(s.sub), keys, env);
      if (code === 404 || code === 410) stmts.push(env.DB.prepare("DELETE FROM subs WHERE id=?").bind(s.id));
      else if (code < 300) stmts.push(env.DB.prepare("UPDATE subs SET last_ok=? WHERE id=?").bind(now, s.id));
    } catch (e) { }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/* ---------- HTTP ---------- */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (d, s = 200, extra = {}) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });
async function body(req) { try { return await req.json() } catch { return {} } }
function cleanPrefs(p = {}) {
  const thr = [25, 50, 100, 150, 250].includes(+p.thr) ? +p.thr : 100;
  return { thr, inPL: p.inPL !== false, near: p.near !== false, toward: p.toward !== false, border: p.border !== false, rcb: p.rcb !== false, news: p.news !== false };
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
    const hours = Math.min(12, Math.max(1, +url.searchParams.get("hours") || 3));
    const res = (hours <= 1 ? 5 : hours <= 3 ? 15 : hours <= 6 ? 30 : 60) * 1000;
    const cache = caches.default, ck = new Request(`${url.origin}/__h/${hours}/${Math.floor(Date.now() / 20000)}`);
    const hit = await cache.match(ck); if (hit) return hit;
    const since = Date.now() - hours * 3600e3;
    const rows = (await env.DB.prepare("SELECT t, d FROM snaps WHERE t >= ? ORDER BY t").bind(since).all()).results || [];
    // ostatnia migawka w każdym przedziale (bez parsowania JSON, żeby nie zużywać czasu procesora)
    const pick = []; for (let k = 0; k < rows.length; k++) { const b = Math.floor(rows[k].t / res); if (k === rows.length - 1 || Math.floor(rows[k + 1].t / res) !== b) pick.push(rows[k]) }
    const al = ((await env.DB.prepare("SELECT t, d FROM alerts_log WHERE t >= (SELECT COALESCE(MAX(t),0) FROM alerts_log WHERE t <= ?) ORDER BY t").bind(since).all()).results || []);
    const body = `{"res":${res},"snaps":[${pick.map(r => `[${r.t},${r.d}]`).join(",")}],"alerts":[${al.map(r => `[${r.t},${r.d}]`).join(",")}]}`;
    const resp = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20", ...CORS } });
    await cache.put(ck, resp.clone()); return resp;
  }

  if (path === "/api/mil") return json({ ...((await kvGet(env, "mil")) || { t: 0, ac: [], trails: {} }), err: await kvGet(env, "mil_err") }, 200, { "Cache-Control": "public, max-age=10" });

  if (path === "/api/status") {
    const last = await env.DB.prepare("SELECT MAX(t) AS t, COUNT(*) AS n FROM snaps").first();
    const st = await env.DB.prepare("SELECT v FROM kv WHERE k='status'").first();
    return json({ ok: true, now: Date.now(), lastSnapshot: last && last.t, snapshots: last && last.n, ...(st ? JSON.parse(st.v) : {}) });
  }
  if (path === "/api/stats") { const days = [7, 14, 30, 90].includes(+url.searchParams.get("days")) ? +url.searchParams.get("days") : 7; return json(await readStats(env, days), 200, { "Cache-Control": "public, max-age=120" }) }
  if (path === "/api/rcb") return json((await kvGet(env, "rcb")) || { t: 0, items: [] }, 200, { "Cache-Control": "public, max-age=30" });
  if (path === "/api/news") return json((await kvGet(env, "news")) || { t: 0, items: [] }, 200, { "Cache-Control": "public, max-age=60" });
  if (path === "/api/messages") {
    const seen = await kvGet(env, "seen");
    if (!seen || Date.now() - seen.t > 5 * 60000) await kvPut(env, "seen", { t: Date.now() }).run();
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
    ctx.waitUntil(run(env).catch(async e => {
      // zapamiętaj błąd, żeby aplikacja mogła pokazać, dlaczego historia się nie zapisuje
      try { await ensureSchema(env); await env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('status',?)").bind(JSON.stringify({ lastRun: Date.now(), ok: false, error: String(e && e.message || e).slice(0, 300) })).run() } catch (_) { }
    }))
  },
};
