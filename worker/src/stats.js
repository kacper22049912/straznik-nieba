// Statystyki dzienne (czas polski): unikalne obiekty wg typu, aktywność w godzinach, najbliższe podejście do RP,
// mapa cieplna tras (komórki 0,25°) i zdarzenia w Polsce. Liczone przyrostowo z migawek historii,
// po 20 migawek na uruchomienie, więc dane sprzed wdrożenia też zostaną policzone (z ostatnich 7 dni).
export const dayKey = t => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
const hourOf = t => +new Date(t).toLocaleString("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hour12: false }).slice(0, 2) % 24;
const blank = day => ({ day, n: 0, ids: {}, hours: Array(24).fill(0), heat: {}, minD: null, pl: {} });

export async function aggregate(env, distFn, roughFn, batch = 20) {
  const cur = await env.DB.prepare("SELECT v FROM kv WHERE k='aggCursor'").first();
  let cursor = cur ? JSON.parse(cur.v).t : 0;
  const rows = (await env.DB.prepare("SELECT t, d FROM snaps WHERE t > ? ORDER BY t LIMIT ?").bind(cursor, batch).all()).results || [];
  if (!rows.length) return 0;
  const days = new Map();
  const get = async day => {
    if (days.has(day)) return days.get(day);
    const r = await env.DB.prepare("SELECT d FROM agg WHERE day=?").bind(day).first();
    const a = r ? JSON.parse(r.d) : blank(day); days.set(day, a); return a;
  };
  for (const { t, d } of rows) {
    const a = await get(dayKey(t)), h = hourOf(t); a.n++;
    let simult = 0;
    for (const r of JSON.parse(d)) {
      const [id, type, lat, lon, , count, f, loc] = r;
      if (f & 2) continue;                       // obserwacja (np. start MiG-31K), nie zagrożenie
      const c = count > 1 ? count : 1; simult += c;
      const e = a.ids[id] || (a.ids[id] = [type, c, null]); if (c > e[1]) e[1] = c;
      if (f & 1 || lat == null) continue;        // tylko obwód, bez pozycji
      const k = Math.floor(lat * 4) + "," + Math.floor(lon * 4); a.heat[k] = (a.heat[k] || 0) + 1;
      // odległość od RP: najpierw zgrubnie, dokładnie tylko gdy może poprawić dzienne minimum
      const rough = roughFn([lat, lon]);
      if (rough < 700 && (!a.minD || rough - 60 < a.minD.d)) {
        const dist = Math.round(distFn([lat, lon]));
        if (e[2] == null || dist < e[2]) e[2] = dist;
        if (!a.minD || dist < a.minD.d) a.minD = { d: dist, t, type, loc };
      }
    }
    if (simult > a.hours[h]) a.hours[h] = simult;
    cursor = t;
  }
  const stmts = [...days.values()].map(a => env.DB.prepare("INSERT OR REPLACE INTO agg(day, d) VALUES(?,?)").bind(a.day, JSON.stringify(a)));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('aggCursor',?)").bind(JSON.stringify({ t: cursor })));
  await env.DB.batch(stmts);
  return rows.length;
}

// zdarzenia w Polsce (upadki/wybuchy z mediów) dopisywane do dnia, w którym się ukazały
export async function addIncidents(env, items) {
  const byDay = new Map();
  for (const n of items) if (n.impact) { const d = dayKey(n.t); (byDay.get(d) || byDay.set(d, []).get(d)).push(n) }
  const stmts = [];
  for (const [day, list] of byDay) {
    const r = await env.DB.prepare("SELECT d FROM agg WHERE day=?").bind(day).first();
    const a = r ? JSON.parse(r.d) : blank(day); let changed = false;
    for (const n of list) if (!a.pl[n.id]) { a.pl[n.id] = { t: n.t, title: n.title, kind: n.kind, place: n.place ? n.place.name : null, link: n.link }; changed = true }
    if (changed) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO agg(day, d) VALUES(?,?)").bind(day, JSON.stringify(a)));
  }
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
