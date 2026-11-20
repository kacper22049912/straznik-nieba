// Doniesienia mediów o zdarzeniach w Polsce (drony, pociski, szczątki, wybuchy, naruszenie przestrzeni powietrznej).
// Źródła: kanały RSS TVN24, RMF24, Polsat News.
// Znacznik na mapie dostaje tylko doniesienie o UPADKU / SZCZĄTKACH / WYBUCHU, z miejscem ustalonym tak:
//   1) „w miejscowości X (w powiecie Y)” → wyszukanie wsi w OpenStreetMap (Nominatim), wynik zapamiętany w D1,
//   2) miasto z listy GeoNames w tym samym zdaniu co słowo o upadku,
//   3) sam powiat („w powiecie biłgorajskim”) → środek powiatu, oznaczony jako przybliżony.
import { PLACES } from "./places.js";

const UA = "StraznikNieba/1.0 (+https://github.com/kacper22049912/straznik-nieba)";
const VERSION = 3;
export const FEEDS = [
  ["TVN24", "https://tvn24.pl/najnowsze.xml"],
  ["RMF24", "https://www.rmf24.pl/fakty/feed"],
  ["Polsat News", "https://www.polsatnews.pl/rss/wszystkie.xml"],
  ["PAŻP", "https://www.pansa.pl/feed/"],
];
const L = "A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż";
const KEY = /\b(dron\w*|bezzałogow\w*|rakiet\w*|pocisk\w*|szczątk\w*|obiekt\w* (?:latając\w*|powietrzn\w*)|naruszeni\w* (?:polskiej )?przestrzeni|przestrzeń powietrzn\w*|przestrzeni powietrzn\w*|zestrzel\w*|eksplozj\w*|wybuch\w*|spadł\w*|atak\w* z powietrza|poderwan\w* myśliw\w*)\b/i;
const IMPACT = /(spadł|spadła|spadły|spadło|upad[ekłu]|szczątk|uderzył|uderzyła|uderzenie w|eksplozj|wybuch|lej po|odnalezion|znalezion|rozbił|płonie|płonął|ujawnieni\w* (?:niezidentyfikowan\w* )?obiekt|zestrzelon)/i;
const PL_CTX = /\b(w Polsce|nad Polską|na terytorium (?:RP|Polski)|polsk\w* przestrze\w*|terytorium RP|Dowództw\w* Operacyjn\w*|polsk\w* (?:myśliwc\w*|lotnictw\w*|wojsk\w*)|gmin\w*|powiat\w*|wojewódz\w*|lubelsk\w*|podkarpack\w*|podlask\w*|mazowieck\w*|warmińsko-mazursk\w*|Lubelszczyzn\w*|Podkarpaci\w*)\b/i;
const NOT_PL = /\b(Ukrain\w*|Kij[oó]w\w*|Rosj\w*|Moskw\w*|Izrael\w*|Iran\w*|Strefie Gazy|Liban\w*|Charkow\w*|Odess\w*|Biał\w*rus\w*|Litw\w*|Rumuni\w*|Niemc\w*)\b/;
const NEG = /\b(ludzki\w* szczątk\w*|szczątki (?:kobiety|mężczyzny|człowieka)|zwłok\w*|nielegalnie lata\w*|dronem nagrywa\w*|pokaz\w* dronów|dron\w* dostawcz\w*|fajerwerk\w*|wybuch\w* gazu|butl\w* gazow\w*|wypad\w* drogow\w*)\b/i;

const ENT = { nbsp: " ", quot: '"', amp: "&", lt: "<", gt: ">", oacute: "ó", Oacute: "Ó", bdquo: "„", rdquo: "”", ldquo: "“", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" };
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`, "i")); return m ? decode(m[1]) : "" };

export function parseRss(xml) {
  const out = []; const re = /<item[\s>][\s\S]*?<\/item>/gi; let m;
  while ((m = re.exec(xml))) {
    const x = m[0];
    out.push({ title: tag(x, "title"), link: tag(x, "link") || tag(x, "guid"), desc: tag(x, "description").slice(0, 600), t: Date.parse(tag(x, "pubDate") || tag(x, "dc:date")) || 0 });
  }
  return out;
}

/* ---------- miasta z listy GeoNames, z odmianą (Zamość → Zamościu, Rzeszów → Rzeszowie) ---------- */
const SUFFIX = new Set(["", "a", "u", "ie", "iu", "ciu", "cia", "em", "iem", "ą", "ę", "y", "i", "owi", "ach", "ami", "zie", "dzi", "dzie", "ia", "ii", "ji", "nie", "rze", "le", "ce", "dze", "ciem", "cie"]);
const STOP = new Set(["Nowe", "Police", "Ruda", "Wola", "Góra", "Dobre", "Stare", "Mała", "Wielka", "Brzeg", "Kosów", "Biała", "Nowa", "Stary", "Polska", "Sejny", "Osie", "Osiek", "Pionki", "Wilków", "Lipno", "Szczytno", "Kolno", "Zabłudów"]);
function bases(name) {
  const b = [name];
  if (name.length >= 6 && /[aeoyąęćśźńi]$/i.test(name)) b.push(name.slice(0, -1));
  if (/ów$/.test(name)) b.push(name.slice(0, -2) + "ow");
  if (/ó[a-ząćęłńóśźż]$/.test(name)) b.push(name.slice(0, -2) + "o" + name.slice(-1));
  if (/ek$/.test(name)) b.push(name.slice(0, -2) + "k");
  if (/iec$/.test(name)) b.push(name.slice(0, -3) + "c");
  return b
}
const wordMatch = (tok, name) => bases(name).some(b => tok.startsWith(b) && SUFFIX.has(tok.slice(b.length)));
const IDX = new Map();
for (const p of PLACES) {
  if (STOP.has(p[0])) continue;
  const words = p[0].split(/\s+/); if (words[0].length < 4) continue;
  const k = words[0].slice(0, 4).toLowerCase();
  (IDX.get(k) || IDX.set(k, []).get(k)).push({ p, words });
}
export function findPlace(s) {
  const toks = s.split(new RegExp(`[^${L}-]+`)).filter(Boolean); let best = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]; if (w.length < 4 || w[0] !== w[0].toUpperCase() || w[0] === w[0].toLowerCase()) continue;
    for (const c of IDX.get(w.slice(0, 4).toLowerCase()) || []) {
      const ok = c.words.every((cw, j) => { const t = toks[i + j]; return t && (cw.length <= 3 || /^[a-ząćęłńóśźż]/.test(cw) ? t === cw : wordMatch(t, cw)) });
      if (ok && (!best || c.p[3] > best[3])) best = c.p;
    }
  }
  return best ? { name: best[0], lat: best[1], lon: best[2] } : null;
}

/* ---------- rodzaj zdarzenia ---------- */
export function kindOf(s) {
  if (/rakiet|pocisk|Ch-?\s?\d{2,3}|Kalibr|Iskander|Kindżał/i.test(s)) return "missile";
  if (/\bdron|bezzałog|Shahed|Gerber|Geran/i.test(s)) return "drone";
  if (/eksplozj|wybuch|płonie|słup ognia|pożar|lej po/i.test(s)) return "explosion";
  if (/szczątk|obiekt|spadł|upad/i.test(s)) return "debris";
  return "airspace";
}

/* ---------- wsie i powiaty: Nominatim (OpenStreetMap), z pamięcią w D1 ---------- */
const VILL = new RegExp(`miejscowoś(?:ci|ć)\\s+([A-ZĄĆĘŁŃÓŚŹŻ][${L}-]+(?:\\s+(?:nad|pod)\\s+[A-ZĄĆĘŁŃÓŚŹŻ][${L}-]+|\\s+[A-ZĄĆĘŁŃÓŚŹŻ][${L}-]+)?)`, "g");
const POW = new RegExp(`pow(?:iecie|iatu|iat|\\.)\\s+([a-ząćęłńóśźż-]+?)(?:skim|ckim|zkim|skiego|ckiego|zkiego|ski|cki|zki)\\b`, "gi");
export function villages(s) { const out = []; let m; VILL.lastIndex = 0; while ((m = VILL.exec(s))) out.push(m[1].trim()); return [...new Set(out)] }
export function powiaty(s) {
  const out = []; let m; POW.lastIndex = 0;
  while ((m = POW.exec(s))) { const end = /c(kim|kiego|ki)$/i.test(m[0]) ? "cki" : /z(kim|kiego|ki)$/i.test(m[0]) ? "zki" : "ski"; out.push(m[1].toLowerCase() + end) }
  return [...new Set(out)]
}
const inPolandBox = (la, lo) => la > 49 && la < 54.9 && lo > 14.1 && lo < 24.2;
async function geocode(env, q, ctx) {
  const k = q.toLowerCase();
  if (env && env.DB) { const r = await env.DB.prepare("SELECT v FROM geo WHERE q=?").bind(k).first(); if (r) return JSON.parse(r.v) }
  if (ctx.calls >= 4) return null; ctx.calls++;
  let res = null;
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=pl&limit=3&accept-language=pl&q=" + encodeURIComponent(q), { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.ok) {
      const arr = await r.json();
      const hit = arr.find(x => inPolandBox(+x.lat, +x.lon));
      if (hit) res = { name: String(hit.name || q.split(",")[0]), lat: +(+hit.lat).toFixed(4), lon: +(+hit.lon).toFixed(4) };
    }
  } catch (e) { }
  if (env && env.DB) await env.DB.prepare("INSERT OR REPLACE INTO geo(q, v, t) VALUES(?,?,?)").bind(k, JSON.stringify(res), Date.now()).run();
  return res;
}

export function classify(it) {
  const s = it.title + ". " + it.desc;
  if (!KEY.test(s) || NEG.test(s)) return null;
  const town = findPlace(it.title) || findPlace(it.desc);
  const ctx = PL_CTX.test(s);
  if (!town && !ctx && !villages(s).length) return null;
  if (NOT_PL.test(it.title) && !ctx && !villages(s).length) return null;
  return { impact: IMPACT.test(s), kind: kindOf(s) };
}

async function locate(env, it, ctx) {
  const s = it.title + ". " + it.desc;
  const pow = powiaty(s)[0];
  for (const v of villages(s)) {
    const g = (pow && await geocode(env, `${v}, powiat ${pow}`, ctx)) || await geocode(env, v, ctx);
    if (g) return { ...g, name: v, how: "village" };
  }
  // miasto tylko w zdaniu (albo tytule), które mówi o upadku / wybuchu
  if (IMPACT.test(it.title)) { const p = findPlace(it.title); if (p) return { ...p, how: "town" } }
  for (const sent of s.split(/(?<=[.!?])\s+/)) if (IMPACT.test(sent)) { const p = findPlace(sent); if (p) return { ...p, how: "town" } }
  if (pow) { const g = await geocode(env, `powiat ${pow}`, ctx); if (g) return { ...g, name: "pow. " + pow, how: "powiat", approx: true } }
  return null;
}

async function hashId(s) { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("") }

export async function fetchNews(prev, env) {
  const fresh = prev && prev.v === VERSION ? prev.items || [] : [];
  const keep = new Map(fresh.filter(i => i.t > Date.now() - 72 * 3600e3).map(i => [i.id, i]));
  const titles = new Set([...keep.values()].map(i => i.title.toLowerCase()));
  const results = await Promise.allSettled(FEEDS.map(async ([src, url]) => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) throw new Error(src + " HTTP " + r.status);
    return parseRss(await r.text()).map(i => ({ ...i, src }));
  }));
  const ctx = { calls: 0 }, all = [];
  for (const res of results) {
    if (res.status !== "fulfilled") continue;
    for (const it of res.value) {
      if (it.title && it.t > Date.now() - 72 * 3600e3) all.push(it);
      if (!it.title || !it.link || (it.t && it.t < Date.now() - 72 * 3600e3)) continue;
      if (titles.has(it.title.toLowerCase())) continue;
      const c = classify(it); if (!c) continue;
      const id = await hashId(it.link); if (keep.has(id)) continue;
      const place = c.impact ? await locate(env, it, ctx) : null;
      keep.set(id, { id, t: it.t || Date.now(), title: it.title, desc: it.desc.slice(0, 300), link: it.link, src: it.src, kind: c.kind, impact: c.impact, place });
      titles.add(it.title.toLowerCase());
    }
  }
  // doniesienia bez miejsca: szukamy w tekście (także w odmianie) miejsc znalezionych w innych doniesieniach
  const known = [...new Map([...keep.values()].filter(i => i.place && i.place.how !== "powiat").map(i => [i.place.name, i.place])).values()];
  for (const i of keep.values()) {
    if (!i.impact || i.place) continue;
    const toks = (i.title + " " + i.desc).split(new RegExp(`[^${L}-]+`)).filter(Boolean);
    const hit = known.find(p => { const ws = p.name.split(/\s+/); return toks.some((_, k) => ws.every((w, j) => toks[k + j] && (w.length <= 3 ? toks[k + j] === w : wordMatch(toks[k + j], w) || toks[k + j] === w + "m"))) });
    if (hit) i.place = { ...hit, how: "same" };
  }
  const items = [...keep.values()].sort((a, b) => b.t - a.t).slice(0, 40);
  return { v: VERSION, t: Date.now(), items, all, errors: results.filter(r => r.status === "rejected").map(r => String(r.reason && r.reason.message || r.reason)) };
}
