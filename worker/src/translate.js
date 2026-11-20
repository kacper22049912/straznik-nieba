// Tłumaczenie wiadomości z kanałów monitoringu (ukraiński / rosyjski → polski) przez Cloudflare Workers AI.
// Główny model: Llama 3.1 8B, paczka wiadomości w jednym zapytaniu, ze słownikiem nazw regionów.
// Zapas: m2m100 wiersz po wierszu, po podmianie nazw regionów. Tłumaczenia są zapamiętywane w D1.
const LLM = "@cf/meta/llama-3.1-8b-instruct";
const MT = "@cf/meta/m2m100-1.2b";
const VER = "v2:";
const REGIONS = {
  "Київщина": "obwód kijowski", "Чернігівщина": "obwód czernihowski", "Сумщина": "obwód sumski", "Харківщина": "obwód charkowski", "Полтавщина": "obwód połtawski",
  "Дніпропетровщина": "obwód dniepropetrowski", "Одещина": "obwód odeski", "Миколаївщина": "obwód mikołajowski", "Херсонщина": "obwód chersoński", "Запоріжжя": "Zaporoże",
  "Житомирщина": "obwód żytomierski", "Вінниччина": "obwód winnicki", "Хмельниччина": "obwód chmielnicki", "Рівненщина": "obwód rówieński", "Волинь": "Wołyń",
  "Львівщина": "obwód lwowski", "Тернопільщина": "obwód tarnopolski", "Черкащина": "obwód czerkaski", "Кіровоградщина": "obwód kirowohradzki", "Донеччина": "obwód doniecki",
  "Закарпаття": "Zakarpacie", "Буковина": "Bukowina", "Прикарпаття": "Przykarpacie", "Київ": "Kijów", "Харків": "Charków", "Одеса": "Odessa", "Львів": "Lwów", "Дніпро": "Dniepr",
  "БпЛА": "dron", "ЧЗВ": "strefa czarnobylska", "КАБ": "KAB", "Шахед": "Shahed", "шахед": "Shahed",
};
const RU = /[ыэъё]/i;
async function key(s) { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(VER + s)); return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("") }
const clean = s => String(s || "").replace(/https?:\/\/\S+/g, "").replace(/[ \t]+/g, " ").trim();

async function llmBatch(env, texts) {
  const dict = Object.entries(REGIONS).slice(0, 30).map(([a, b]) => `${a} = ${b}`).join("; ");
  const r = await env.AI.run(LLM, {
    messages: [
      { role: "system", content: "Jesteś tłumaczem komunikatów o zagrożeniach z powietrza. Tłumacz z ukraińskiego lub rosyjskiego na naturalny polski. Zachowaj emoji, liczby, strzałki i nazwy kanałów (@...). Nazwy miejscowości ukraińskich zapisuj w polskiej transkrypcji (np. Ріпки = Ripki, Любеч = Lubecz). Słownik: " + dict + ". Odpowiedz wyłącznie tablicą JSON z tłumaczeniami w tej samej kolejności, bez komentarzy." },
      { role: "user", content: JSON.stringify(texts) },
    ],
    max_tokens: 2500, temperature: 0.1,
  });
  const txt = String(r && (r.response ?? r.result?.response) || "");
  const a = txt.indexOf("["), b = txt.lastIndexOf("]");
  const arr = JSON.parse(txt.slice(a, b + 1));
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error("zła odpowiedź modelu");
  return arr.map(x => String(x || "").trim());
}
async function mtOne(env, text) {
  const lines = text.split("\n"), out = [];
  for (let l of lines) {
    if (!/[а-яіїєґ]/i.test(l)) { out.push(l); continue }
    for (const [a, b] of Object.entries(REGIONS)) l = l.split(a).join(b);
    const r = await env.AI.run(MT, { text: l, source_lang: RU.test(l) ? "ru" : "uk", target_lang: "pl" });
    out.push((r && r.translated_text) || l);
  }
  return out.join("\n");
}

export async function translateMessages(env, messages, budget = 12) {
  const out = messages.map(m => ({ ...m }));
  const srcs = out.map(m => clean(m.text));
  const keys = await Promise.all(srcs.map(key));
  const known = new Map(), uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += 50) {
    const part = uniq.slice(i, i + 50);
    const rows = (await env.DB.prepare(`SELECT h, pl FROM tr WHERE h IN (${part.map(() => "?").join(",")})`).bind(...part).all()).results || [];
    for (const r of rows) known.set(r.h, r.pl);
  }
  const todo = [];
  for (let i = 0; i < out.length; i++) {
    if (known.has(keys[i])) { out[i].pl = known.get(keys[i]); continue }
    if (!srcs[i] || !/[а-яіїєґё]/i.test(srcs[i])) continue;   // nie ma czego tłumaczyć
    if (srcs[i].length <= 1500 && !todo.some(j => keys[j] === keys[i])) todo.push(i);
  }
  const batch = todo.slice(0, budget);
  if (env.AI && batch.length) {
    let res = null;
    try { res = await llmBatch(env, batch.map(i => srcs[i])) } catch (e) { res = null }
    if (!res) { res = []; for (const i of batch.slice(0, 4)) { try { res.push(await mtOne(env, srcs[i])) } catch (e) { res.push(null); break } } }
    const writes = [];
    batch.forEach((i, n) => { const pl = res[n]; if (pl) { known.set(keys[i], pl); writes.push(env.DB.prepare("INSERT OR REPLACE INTO tr(h, pl, t) VALUES(?,?,?)").bind(keys[i], pl, Date.now())) } });
    if (writes.length) await env.DB.batch(writes);
    for (let i = 0; i < out.length; i++) if (!out[i].pl && known.has(keys[i])) out[i].pl = known.get(keys[i]);
  }
  return out;
}
