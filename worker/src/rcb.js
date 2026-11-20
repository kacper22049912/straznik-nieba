// Alerty RCB ze strony gov.pl/web/rcb: lista wpisów i treść aktualizacji (godzina, komunikat, obszar).
const BASE = "https://www.gov.pl";
const UA = "StraznikNieba/1.0 (+https://github.com/kacper22049912/straznik-nieba)";
const VOIV = [
  ["dolnośląsk", "dolnośląskie"], ["kujawsko-pomorsk", "kujawsko-pomorskie"], ["lubelsk", "lubelskie"], ["lubusk", "lubuskie"],
  ["łódzk", "łódzkie"], ["małopolsk", "małopolskie"], ["mazowieck", "mazowieckie"], ["opolsk", "opolskie"], ["podkarpack", "podkarpackie"],
  ["podlask", "podlaskie"], ["zachodniopomorsk", "zachodniopomorskie"], ["pomorsk", "pomorskie"], ["śląsk", "śląskie"],
  ["świętokrzysk", "świętokrzyskie"], ["warmińsko-mazursk", "warmińsko-mazurskie"], ["wielkopolsk", "wielkopolskie"],
];
const ENT = { nbsp: " ", quot: '"', amp: "&", lt: "<", gt: ">", oacute: "ó", Oacute: "Ó", bdquo: "„", rdquo: "”", ldquo: "“", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»" };
const decode = s => s.replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = h => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);

export function voivodeships(s) {
  // tylko formy województw („lubelskiego”, „woj. lubelskie”), nie powiatów („opolski”)
  const low = s.toLowerCase(), out = [];
  for (const [stem, name] of VOIV) {
    const re = new RegExp("(^|[^a-ząćęłńóśźż-])" + stem + "(iego|ie|iej|ich)(?![a-ząćęłńóśźż])", "g");
    if (re.test(low) && !out.includes(name)) out.push(name);
  }
  return out;
}
export function levelOf(s) {
  if (/zagrożenie atakiem|znajdź bezpieczne miejsce|schron|ukryj się/i.test(s)) return 2;
  if (/odwołano|zakończył|brak zagrożenia|koniec zagrożenia/i.test(s)) return 0;
  return 1;
}

export function parseList(html) {
  const items = [], re = /<span class="date">\s*(\d{2})\.(\d{2})\.(\d{4})\s*<\/span>[\s\S]{0,400}?<a href="\/web\/rcb\/([^"]+)">\s*([^<]+?)\s*<\/a>/g;
  let m; while ((m = re.exec(html))) {
    const title = decode(m[5]);
    if (!/^alert rcb/i.test(title)) continue;
    items.push({ id: m[4], title, date: `${m[3]}-${m[2]}-${m[1]}`, url: `${BASE}/web/rcb/${m[4]}` });
  }
  return items;
}

export function parseDetail(html) {
  const a = html.indexOf("<article"), b = html.indexOf("</article>", a);
  const lines = text(a >= 0 && b > a ? html.slice(a, b) : html);
  const updates = []; let cur = { time: null, parts: [] };
  for (const l of lines) {
    const m = l.match(/^aktualizacja\s*[-–—]?\s*g(?:odz)?\.?\s*(\d{1,2})[:.](\d{2})/i);
    if (m) { updates.push(cur); cur = { time: `${m[1].padStart(2, "0")}:${m[2]}`, parts: [] }; continue }
    if (/^-{5,}$/.test(l)) continue;
    cur.parts.push(l);
  }
  updates.push(cur);
  return updates.map(u => {
    const body = u.parts.join(" ");
    const quote = (body.match(/[„"]([^”"]{10,600})[”"]/) || [])[1] || "";
    const area = (body.match(/(Alert RCB (?:został|zostanie) wysłany[^.]*(?:\.[^„]*)?)/i) || [])[1] || "";
    return { time: u.time, text: quote.trim(), area: area.trim().slice(0, 900), voiv: voivodeships(area), level: levelOf(quote || body) };
  }).filter(u => u.text || u.area).slice(0, 12);
}

export async function fetchRcb(prev) {
  const r = await fetch(BASE + "/web/rcb", { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error("gov.pl HTTP " + r.status);
  const list = parseList(await r.text()).slice(0, 6);
  const old = new Map((prev && prev.items || []).map(i => [i.id, i]));
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  let fetched = 0; const items = [];
  for (const it of list) {
    const o = old.get(it.id);
    // treść pobieramy dla nowych wpisów oraz ponownie dla dzisiejszych/wczorajszych (dopisywane są aktualizacje)
    if ((!o || it.date === today || it.date === yesterday) && fetched < 3) {
      try { const d = await fetch(it.url, { headers: { "User-Agent": UA, Accept: "text/html" } }); if (d.ok) { it.updates = parseDetail(await d.text()); fetched++ } } catch (e) { }
    }
    if (!it.updates) it.updates = o ? o.updates : [];
    items.push(it);
  }
  return { t: Date.now(), items };
}
