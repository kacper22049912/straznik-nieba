// Tłumaczenie wiadomości z kanałów monitoringu (ukraiński / rosyjski → polski) przez Cloudflare Workers AI.
// Tłumaczenia są zapamiętywane w D1, więc każda wiadomość jest tłumaczona tylko raz.
const MODEL = "@cf/meta/m2m100-1.2b";
const RU = /[ыэъё]/i;
async function key(s) { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("") }
const clean = s => String(s || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();

export async function translateMessages(env, messages, budget = 8) {
  const out = messages.map(m => ({ ...m }));
  const keys = await Promise.all(out.map(m => key(clean(m.text))));
  const uniq = [...new Set(keys)];
  const known = new Map();
  for (let i = 0; i < uniq.length; i += 50) {
    const part = uniq.slice(i, i + 50);
    const rows = (await env.DB.prepare(`SELECT h, pl FROM tr WHERE h IN (${part.map(() => "?").join(",")})`).bind(...part).all()).results || [];
    for (const r of rows) known.set(r.h, r.pl);
  }
  const writes = [];
  for (let i = 0; i < out.length; i++) {
    const k = keys[i], src = clean(out[i].text);
    if (known.has(k)) { out[i].pl = known.get(k); continue }
    if (!env.AI || budget <= 0 || !src || src.length > 1500) continue;
    if (!/[а-яіїєґ]/i.test(src)) { known.set(k, src); out[i].pl = src; continue }   // już po łacinie: bez tłumaczenia
    budget--;
    try {
      const r = await env.AI.run(MODEL, { text: src, source_lang: RU.test(src) ? "ru" : "uk", target_lang: "pl" });
      const pl = r && (r.translated_text || r.result && r.result.translated_text);
      if (pl) { out[i].pl = pl; known.set(k, pl); writes.push(env.DB.prepare("INSERT OR REPLACE INTO tr(h, pl, t) VALUES(?,?,?)").bind(k, pl, Date.now())) }
    } catch (e) { budget = 0 }   // limit darmowego planu albo błąd modelu: spróbujemy w następnej minucie
  }
  if (writes.length) await env.DB.batch(writes);
  return out;
}
