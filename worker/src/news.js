// Doniesienia mediów o zdarzeniach w Polsce (drony, pociski, szczątki, naruszenie przestrzeni powietrznej).
// Źródła: kanały RSS TVN24, RMF24, Polsat News. Miejsce zdarzenia ustalane po nazwie miejscowości w tekście.
import { PLACES } from "./places.js";

const UA = "StraznikNieba/1.0 (+https://github.com/kacper22049912/straznik-nieba)";
export const FEEDS = [
  ["TVN24", "https://tvn24.pl/najnowsze.xml"],
  ["RMF24", "https://www.rmf24.pl/fakty/feed"],
  ["Polsat News", "https://www.polsatnews.pl/rss/wszystkie.xml"],
];
const KEY = /\b(dron\w*|bezzałogow\w*|rakiet\w*|pocisk\w*|szczątk\w*|obiekt\w* (?:latając\w*|powietrzn\w*)|naruszeni\w* (?:polskiej )?przestrzeni|przestrzeń powietrzn\w*|przestrzeni powietrzn\w*|zestrzel\w*|eksplozj\w*|wybuch\w*|spadł\w*|lej\w* po wybuchu|atak\w* z powietrza|poderwan\w* myśliw\w*)\b/i;
const PL_CTX = /\b(w Polsce|nad Polską|na terytorium (?:RP|Polski)|polsk\w* przestrze\w*|terytorium RP|Dowództw\w* Operacyjn\w*|polsk\w* (?:myśliwc\w*|lotnictw\w*|wojsk\w*)|gmin\w*|powiat\w*|wojewódz\w*|lubelsk\w*|podkarpack\w*|podlask\w*|mazowieck\w*|warmińsko-mazursk\w*)\b/i;
const NOT_PL = /\b(Ukrain\w*|Kij[oó]w\w*|Rosj\w*|Moskw\w*|Izrael\w*|Iran\w*|Strefie Gazy|Liban\w*|Charkow\w*|Odess\w*|Biał\w*rus\w*|Litw\w*|Rumuni\w*|Niemc\w*)\b/;

const ENT = { nbsp: " ", quot: '"', amp: "&", lt: "<", gt: ">", oacute: "ó", Oacute: "Ó", bdquo: "„", rdquo: "”", ldquo: "“", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" };
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`, "i")); return m ? decode(m[1]) : "" };

export function parseRss(xml) {
  const out = []; const re = /<item[\s>][\s\S]*?<\/item>/gi; let m;
  while ((m = re.exec(xml))) {
    const x = m[0];
    out.push({ title: tag(x, "title"), link: tag(x, "link") || tag(x, "guid"), desc: tag(x, "description").slice(0, 600), t: Date.parse(tag(x, "pubDate") || tag(x, "dc:date")) || 0 });
  }
  return out;
}

// indeks miejscowości po 4 pierwszych literach; dopasowanie z uwzględnieniem odmiany (Zamość → Zamościu, Rzeszów → Rzeszowie)
const SUFFIX = new Set(["", "a", "u", "ie", "iu", "ciu", "cia", "em", "iem", "ą", "ę", "y", "i", "owi", "ach", "ami", "zie", "dzi", "dzie", "ia", "ii", "ji", "nie", "rze", "le", "ce", "dze", "ciem", "cie"]);
const STOP = new Set(["Nowe", "Police", "Ruda", "Wola", "Góra", "Dobre", "Stare", "Mała", "Wielka", "Brzeg", "Kosów", "Biała", "Nowa", "Stary", "Polska", "Sejny"]);
function bases(name) {
  const b = [name];
  if (/[aeoyąęć śźńi]$/i.test(name.slice(-1))) b.push(name.slice(0, -1));
  if (/ów$/.test(name)) b.push(name.slice(0, -2) + "ow");
  if (/ó[a-z]$/.test(name)) b.push(name.slice(0, -2) + "o" + name.slice(-1));
  if (/ek$/.test(name)) b.push(name.slice(0, -2) + "k");
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
  const toks = s.split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż-]+/).filter(Boolean); let best = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]; if (w.length < 4 || w[0] !== w[0].toUpperCase() || w[0] === w[0].toLowerCase()) continue;
    for (const c of IDX.get(w.slice(0, 4).toLowerCase()) || []) {
      // wyrazy pomocnicze w nazwie („nad”, „pod”) muszą wystąpić dokładnie
      const ok = c.words.every((cw, j) => { const t = toks[i + j]; return t && (cw.length <= 3 || /^[a-ząćęłńóśźż]/.test(cw) ? t === cw : wordMatch(t, cw)) });
      if (ok && (!best || c.p[3] > best[3])) best = c.p;
    }
  }
  return best ? { name: best[0], lat: best[1], lon: best[2] } : null;
}

const NEG = /\b(ludzki\w* szczątk\w*|szczątki (?:kobiety|mężczyzny|człowieka)|zwłok\w*|nielegalnie lata\w*|dronem nagrywa\w*|pokaz\w* dronów|dron\w* dostawcz\w*|fajerwerk\w*|wybuch\w* gazu|butl\w* gazow\w*)\b/i;
export function classify(it) {
  const s = it.title + ". " + it.desc;
  if (!KEY.test(s) || NEG.test(s)) return null;
  const place = findPlace(it.title) || findPlace(it.desc);
  const ctx = PL_CTX.test(s);
  if (!place && !ctx) return null;
  if (!place && NOT_PL.test(it.title)) return null;
  if (place && NOT_PL.test(it.title) && !ctx) return null;
  return { place };
}

async function hashId(s) { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("") }

export async function fetchNews(prev) {
  const keep = new Map((prev && prev.items || []).filter(i => i.t > Date.now() - 72 * 3600e3).map(i => [i.id, i]));
  const results = await Promise.allSettled(FEEDS.map(async ([src, url]) => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) throw new Error(src + " HTTP " + r.status);
    return parseRss(await r.text()).map(i => ({ ...i, src }));
  }));
  for (const res of results) {
    if (res.status !== "fulfilled") continue;
    for (const it of res.value) {
      if (!it.title || !it.link || (it.t && it.t < Date.now() - 72 * 3600e3)) continue;
      const c = classify(it); if (!c) continue; const place = c.place;
      const id = await hashId(it.link); if (keep.has(id)) continue;
      keep.set(id, { id, t: it.t || Date.now(), title: it.title, desc: it.desc.slice(0, 300), link: it.link, src: it.src, place: place || null });
    }
  }
  const items = [...keep.values()].sort((a, b) => b.t - a.t).slice(0, 40);
  return { t: Date.now(), items, errors: results.filter(r => r.status === "rejected").map(r => String(r.reason && r.reason.message || r.reason)) };
}
