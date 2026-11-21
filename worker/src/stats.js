// Statystyki dzienne (czas polski): unikalne obiekty wg typu, aktywność w godzinach, najbliższe podejście do RP,
// mapa cieplna tras (komórki 0,25°) i zdarzenia w Polsce. Liczone co minutę z bieżącej migawki; przechowywane 90 dni.
export const dayKey = t => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
const hourOf = t => +new Date(t).toLocaleString("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hour12: false }).slice(0, 2) % 24;
const blank = day => ({ day, n: 0, ids: {}, hours: Array(24).fill(0), heat: {}, minD: null, pl: {} });

// jedna migawka na minutę (wywoływane z zadania co minutę)
export async function aggregateRows(env, t, rows, distFn, roughFn) {
  const day = dayKey(t), h = hourOf(t);
  const r0 = await env.DB.prepare("SELECT d FROM agg WHERE day=?").bind(day).first();
  const a = r0 ? JSON.parse(r0.d) : blank(day); a.n++;
  let simult = 0;
  for (const r of rows) {
    const [id, type, lat, lon, , count, f, loc] = r;
    if (f & 2) continue;
    const c = count > 1 ? count : 1; simult += c;
    const e = a.ids[id] || (a.ids[id] = [type, c, null]); if (c > e[1]) e[1] = c;
    if (f & 1 || lat == null) continue;
    const k = Math.floor(lat * 4) + "," + Math.floor(lon * 4); a.heat[k] = (a.heat[k] || 0) + 1;
    const rough = roughFn([lat, lon]);
    if (rough < 700 && (!a.minD || rough - 60 < a.minD.d)) {
      const dist = Math.round(distFn([lat, lon]));
      if (e[2] == null || dist < e[2]) e[2] = dist;
      if (!a.minD || dist < a.minD.d) a.minD = { d: dist, t, type, loc };
    }
  }
  if (simult > a.hours[h]) a.hours[h] = simult;
  await env.DB.prepare("INSERT OR REPLACE INTO agg(day, d) VALUES(?,?)").bind(day, JSON.stringify(a)).run();
}

// zdarzenia w Polsce (upadki/wybuchy z mediów) dopisywane do dnia, w którym się ukazały
export async function addIncidents(env, items, v = 0) {
  // gdy zmienia się sposób rozpoznawania miejsc (wersja), zdarzenia z ostatnich dni są liczone od nowa
  const since = dayKey(Date.now() - 4 * 864e5), rows = (await env.DB.prepare("SELECT day, d FROM agg WHERE day >= ?").bind(since).all()).results || [];
  const days = new Map(rows.map(r => [r.day, { a: JSON.parse(r.d), changed: false }]));
  for (const [, x] of days) if (x.a.pv !== v) { x.a.pl = {}; x.a.pv = v; x.changed = true }
  for (const n of items) if (n.impact) {
    const day = dayKey(n.t); let x = days.get(day);
    if (!x) { if (day < since) continue; x = { a: { ...blank(day), pv: v }, changed: true }; days.set(day, x) }
    if (!x.a.pl[n.id]) { x.a.pl[n.id] = { t: n.t, title: n.title, kind: n.kind, place: n.place ? n.place.name : null, link: n.link }; x.changed = true }
  }
  const stmts = [...days].filter(([, x]) => x.changed).map(([day, x]) => env.DB.prepare("INSERT OR REPLACE INTO agg(day, d) VALUES(?,?)").bind(day, JSON.stringify(x.a)));
  if (stmts.length) await env.DB.batch(stmts);
}

export async function readStats(env, days) {
  const since = dayKey(Date.now() - (days - 1) * 864e5);
  const rows = (await env.DB.prepare("SELECT day, d FROM agg WHERE day >= ? ORDER BY day").bind(since).all()).results || [];
  const heat = {}, out = [];
  for (const { day, d } of rows) {
    const a = JSON.parse(d), types = {};
    for (const [, [type, c]] of Object.entries(a.ids)) types[type] = (types[type] || 0) + c;
    for (const [k, v] of Object.entries(a.heat)) heat[k] = (heat[k] || 0) + v;
    out.push({ day, coverage: Math.min(1, a.n / 1440), types, hours: a.hours, minD: a.minD, pl: Object.values(a.pl).sort((x, y) => y.t - x.t) });
  }
  const cells = Object.entries(heat).sort((x, y) => y[1] - x[1]).slice(0, 4000).map(([k, v]) => { const [a, b] = k.split(","); return [+a, +b, v] });
  return { days: out, heat: cells, cell: 0.25 };
}
