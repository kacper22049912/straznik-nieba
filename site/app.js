"use strict";
/* Strażnik Nieba: logika aplikacji.
   Dane na żywo: WebSocket NEPTUN, potem REST, a na końcu kopia z własnego workera.
   Oś czasu: historia z workera (co minutę, do 24 h) albo zapis lokalny od otwarcia strony.
   Powiadomienia w tle: Web Push przez worker i service worker (sw.js). */

const $ = id => document.getElementById(id);
const G = window.GEO || {}, UA = window.UA || { oblasts: [], raions: [] };
const CFG = window.SN_CONFIG || {};
const WORKER = (CFG.worker || "").replace(/\/+$/, "");
const API = "https://neptun.in.ua";
const R = Math.PI / 180;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("sn:" + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem("sn:" + k, JSON.stringify(v)) } catch (e) { } }
};
const hm = t => new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = () => innerWidth <= 900;

/* ---------- geometria ---------- */
function km(a, b) { return Math.hypot((b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * R) * 111.32, (b[0] - a[0]) * 110.57) }
function move(p, brg, d) { return [p[0] + d * Math.cos(brg * R) / 110.57, p[1] + d * Math.sin(brg * R) / (111.32 * Math.cos(p[0] * R))] }
function inRing(p, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1]) c = !c } return c }
function inPL(p) { return p[0] > 48.9 && p[0] < 54.95 && p[1] > 14 && p[1] < 24.2 && (G.PL || []).some(poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h))) }
const PLPTS = (G.PL || []).flatMap(p => p[0]).filter((_, i) => i % 3 === 0);
function distPL(p) { if (km(p, [51.9, 19.1]) > 1400) return km(p, [51.9, 19.1]) - 330; let m = 1e9; for (const q of PLPTS) { const d = km(p, q); if (d < m) m = d } return m }
function towardPL(p, hdg) { if (hdg == null) return null; for (let d = 10; d <= 300; d += 10) if (inPL(move(p, hdg, d))) return d; return null }
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const dirName = h => DIRS[Math.round(((h % 360) + 360) % 360 / 22.5) % 16];

/* ---------- typy i sylwetki (dziób w górę, obracane wg kursu) ---------- */
const SVG = {
  uav: '<path fill="currentColor" d="M12 2.2c.7 0 1.1.9 1.3 2.2l.4 3.2 7.3 9.4v1.6l-1.6.4v1.6l-.9.2-.4-1.6-5.6-1.3-.3 1.9h-.4l-.3-1.9-5.6 1.3-.4 1.6-.9-.2v-1.6l-1.6-.4v-1.6l7.3-9.4.4-3.2c.2-1.3.6-2.2 1.3-2.2z"/><rect x="9.6" y="20.4" width="4.8" height=".9" rx=".45" fill="currentColor" opacity=".7"/>',
  recon: '<path fill="currentColor" d="M11.2 3h1.6l.5 3.2V19l2.6.8v1.1H8.1v-1.1l2.6-.8V6.2z"/><rect x="2.5" y="7.4" width="19" height="2.2" rx="1.1" fill="currentColor"/>',
  missile: '<path fill="currentColor" d="M12 1.5c.9 0 1.3 1.5 1.3 3V17l2.6 2.6v1l-2.6-.9-.3 1.3h-2l-.3-1.3-2.6.9v-1L10.7 17V4.5c0-1.5.4-3 1.3-3z"/><path fill="currentColor" d="M10.7 9.5 6 13.2v1l4.7-1.8zM13.3 9.5 18 13.2v1l-4.7-1.8z"/><path class="flame" fill="#ffd27a" d="M11 21.4h2l-1 2.4z"/>',
  ballistic: '<path fill="currentColor" d="M12 1c1.4 1.3 2.2 3.4 2.2 5.6V16l2.4 3.2v1.2H7.4v-1.2L9.8 16V6.6C9.8 4.4 10.6 2.3 12 1z"/><circle cx="12" cy="7.5" r="1.1" fill="#050b16"/><path class="flame" fill="#ffd27a" d="M10 20.4h4l-2 3.4z"/>',
  kab: '<path fill="currentColor" d="M12 2.2c1.5 0 2.4 1.9 2.4 4.4v9.8l2 2.6v1.4l-2-.8-.3 1.6H9.9l-.3-1.6-2 .8V19l2-2.6V6.6c0-2.5.9-4.4 2.4-4.4z"/><path fill="currentColor" opacity=".75" d="M9.6 10.5 4 14.5v1.2l5.6-2.4zM14.4 10.5l5.6 4v1.2l-5.6-2.4z"/>',
  mig31k: '<path fill="currentColor" d="M12 1.5c.6 0 1 1 1.1 2.4l.3 3.8 7.6 6.2v1.7l-7.3-2.1-.2 3.7 3 2.3v1.4l-3.4-.9-.6 1.5h-1l-.6-1.5-3.4.9v-1.4l3-2.3-.2-3.7L3 15.6v-1.7l7.6-6.2.3-3.8c.1-1.4.5-2.4 1.1-2.4z"/>',
  unknown: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path fill="currentColor" d="M11 15.5h2v2h-2zm1-9.2c1.9 0 3.2 1.1 3.2 2.7 0 1.3-.8 2-1.6 2.5-.6.4-.7.6-.7 1.3v.4h-1.9v-.6c0-1.2.5-1.8 1.3-2.3.6-.4.9-.7.9-1.2 0-.6-.5-1-1.2-1-.8 0-1.3.5-1.4 1.2H8.8c.1-1.8 1.4-3 3.2-3z"/>'
};
const TYPES = {
  uav: { n: "Dron uderzeniowy", s: "SHAHED", c: "#ff3b4e" }, recon: { n: "Dron rozpoznawczy", s: "ZWIAD", c: "#ff8a3d" },
  missile: { n: "Pocisk manewrujący", s: "RAKIETA", c: "#ffb020" }, ballistic: { n: "Pocisk balistyczny", s: "BALIST.", c: "#ff4fd8" },
  kab: { n: "Bomba szybująca KAB", s: "KAB", c: "#ffe14d" }, mig31k: { n: "MiG-31K w powietrzu", s: "MiG-31K", c: "#b18cff" },
  unknown: { n: "Nieznany obiekt", s: "OBIEKT", c: "#9aa7bd" }
};
const TM = t => TYPES[t] || TYPES.unknown;
const icon = (t, rot) => `<svg viewBox="0 0 24 24"${rot != null ? ` style="transform:rotate(${Math.round(rot)}deg)"` : ""}>${SVG[t] || SVG.unknown}</svg>`;
$("legend-rows").innerHTML = Object.entries(TYPES).map(([k, m]) => `<div><span style="color:${m.c}">${icon(k)}</span>${m.n}</div>`).join("");

/* ---------- mapa ---------- */
const map = L.map("map", { zoomSnap: .25, minZoom: 4, maxZoom: 11, zoomControl: false, attributionControl: false, preferCanvas: true, maxBounds: [[40, 5], [63, 47]] });
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
const svgR = L.svg({ padding: .3 });
const HOME = () => mobile() ? [[46.5, 14.2], [54.9, 33]] : [[45.6, 13.8], [55.2, 38.5]];
const homePad = () => ({ paddingTopLeft: [0, mobile() ? 80 : 90], paddingBottomRight: [mobile() ? 0 : 390, mobile() ? 100 : 110] });
map.fitBounds(HOME(), homePad());
let userMoved = false;
map.getContainer().addEventListener("pointerdown", () => userMoved = true);
map.getContainer().addEventListener("wheel", () => userMoved = true, { passive: true });
$("b-home").onclick = () => { userMoved = false; map.flyToBounds(HOME(), { ...homePad(), duration: .9 }) };
const zcls = () => map.getContainer().classList.toggle("lowz", map.getZoom() < 6.25); map.on("zoomend", zcls); zcls();

const NEI = { UA: "#0f1c30", BY: "#131a2b", RU: "#151829" };
for (const [k, polys] of Object.entries(G)) { if (k === "PL") continue; L.polygon(polys, { color: NEI[k] ? "#2c2f48" : "#1a2840", weight: 1, fillColor: NEI[k] || "#0c1626", fillOpacity: 1, interactive: false }).addTo(map) }
for (const o of UA.oblasts) L.polygon(o.g, { color: "#203152", weight: .8, fill: false, interactive: false }).addTo(map);
if (G.PL) {
  L.polygon(G.PL, { stroke: false, fillColor: "#0e1d35", fillOpacity: 1, interactive: false }).addTo(map);
  L.polygon(G.PL, { color: "#ff3b4e", weight: 18, opacity: .08, fill: false, interactive: false }).addTo(map);
  L.polygon(G.PL, { color: "#ff3b4e", weight: 7, opacity: .18, fill: false, interactive: false }).addTo(map);
  L.polygon(G.PL, { color: "#ffffff", weight: 2.6, opacity: .95, fill: false, interactive: false }).addTo(map);
  L.polygon(G.PL, { color: "#ff3b4e", weight: 1.6, opacity: 1, fill: false, interactive: false, renderer: svgR, className: "pl-march" }).addTo(map);
}
const label = (ll, html, cls) => L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="${cls}">${html}</div>`, iconSize: null, iconAnchor: [3, 7] }) });
[["POLSKA", 52.1, 18.2, "country pl"], ["UKRAINA", 49.0, 30.5, "country"], ["BIAŁORUŚ", 53.5, 27.8, "country"], ["LITWA", 55.35, 24.0, "country"], ["ROSJA", 54.95, 21.3, "country"], ["SŁOWACJA", 48.75, 19.3, "country"], ["CZECHY", 49.75, 15.3, "country"], ["MOŁDAWIA", 47.2, 28.4, "country"]]
  .forEach(([t, a, b, c]) => label([a, b], t, c).addTo(map));
const CITIES = [["Warszawa", 52.23, 21.01, 1], ["Kraków", 50.06, 19.94, 1], ["Gdańsk", 54.35, 18.65, 1], ["Wrocław", 51.11, 17.03, 1], ["Poznań", 52.41, 16.93, 1], ["Łódź", 51.76, 19.46, 1],
  ["Lublin", 51.25, 22.57, 1], ["Rzeszów", 50.04, 22.0, 1], ["Białystok", 53.13, 23.16, 1], ["Olsztyn", 53.78, 20.49, 1], ["Kielce", 50.87, 20.63, 1], ["Szczecin", 53.43, 14.55, 1], ["Katowice", 50.26, 19.02, 1], ["Bydgoszcz", 53.12, 18.0, 1],
  ["Zamość", 50.72, 23.25], ["Chełm", 51.14, 23.47], ["Hrubieszów", 50.81, 23.89], ["Przemyśl", 49.78, 22.77], ["Biała Podlaska", 52.03, 23.12], ["Suwałki", 54.1, 22.93], ["Włodawa", 51.55, 23.55], ["Tomaszów Lub.", 50.45, 23.42]];
const FOREIGN = [["Lwów", 49.84, 24.03, 1], ["Łuck", 50.75, 25.34], ["Kowel", 51.21, 24.71], ["Równe", 50.62, 26.25], ["Kijów", 50.45, 30.52, 1], ["Mińsk", 53.9, 27.57, 1], ["Brześć", 52.1, 23.69], ["Grodno", 53.68, 23.83], ["Kaliningrad", 54.71, 20.51], ["Wilno", 54.69, 25.28, 1], ["Odessa", 46.48, 30.72, 1], ["Charków", 49.99, 36.23, 1], ["Tarnopol", 49.55, 25.59], ["Użhorod", 48.62, 22.29], ["Żytomierz", 50.25, 28.66]];
for (const c of [...CITIES, ...FOREIGN]) label([c[1], c[2]], `<i></i>${c[0]}`, "city" + (c[3] ? " cap" : "")).addTo(map);
function nearestPLCity(p) { let b = CITIES[0], m = 1e9; for (const c of CITIES) { const d = km(p, [c[1], c[2]]); if (d < m) { m = d; b = c } } return b[0] }

/* ---------- stan ---------- */
const live = { threats: new Map(), alerts: null, haveData: false };
let messages = [];
let mode = "live", histTime = 0;      // tryb: na żywo albo historia
let view = [], selected = null;
let thr = +store.get("thr", 100); $("i-thr").value = String(thr);
const RAION = new Map(UA.raions.map(r => [r.k, r])), OBL = new Map(UA.oblasts.map(o => [o.k, o]));
const OBL_BY_NAME = new Map(UA.oblasts.map(o => [o.n, o]));
const BORDER_OBL = ["Волинська область", "Львівська область", "Закарпатська область"];

/* ---------- radar ---------- */
map.createPane("radar"); map.getPane("radar").style.zIndex = 450; map.getPane("radar").style.pointerEvents = "none";
const cv = document.createElement("canvas"); map.getPane("radar").appendChild(cv); const cx = cv.getContext("2d");
const RC = [51.0, 23.9], RANGE = 700, PERIOD = 6000; let dpr = 1;
function sizeCanvas() { const s = map.getSize(); dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = s.x * dpr; cv.height = s.y * dpr; cv.style.width = s.x + "px"; cv.style.height = s.y + "px" }
sizeCanvas(); map.on("resize", sizeCanvas);
let zooming = false; map.on("zoomstart", () => { zooming = true; cv.style.opacity = 0 }); map.on("zoomend", () => { zooming = false; cv.style.opacity = 1 });
let lastFrame = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (zooming || ts - lastFrame < 33 || document.hidden) return; lastFrame = ts;
  L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
  const s = map.getSize(); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, s.x, s.y);
  const hist = mode === "hist", RCOL = hist ? "255,190,80" : "56,225,255";
  const c = map.latLngToContainerPoint(RC), edge = map.latLngToContainerPoint(move(RC, 90, RANGE)); const rad = Math.abs(edge.x - c.x);
  cx.lineWidth = 1; cx.font = "500 10px 'JetBrains Mono',monospace";
  for (let k = 100; k <= RANGE; k += 100) {
    const r = rad * k / RANGE; cx.beginPath(); cx.arc(c.x, c.y, r, 0, 7); cx.strokeStyle = `rgba(${RCOL},${k % 300 === 0 ? .22 : .1})`; cx.setLineDash(k % 300 === 0 ? [] : [2, 5]); cx.stroke();
    if (r > 40) { cx.fillStyle = `rgba(${RCOL},.45)`; cx.fillText(k + " km", c.x + 4, c.y - r - 4) }
  }
  cx.setLineDash([]); cx.strokeStyle = `rgba(${RCOL},.12)`; cx.beginPath(); cx.moveTo(c.x - rad, c.y); cx.lineTo(c.x + rad, c.y); cx.moveTo(c.x, c.y - rad); cx.lineTo(c.x, c.y + rad); cx.stroke();
  for (let a = 0; a < 360; a += 10) { const r2 = rad - (a % 30 ? 5 : 11); cx.beginPath(); cx.moveTo(c.x + Math.sin(a * R) * rad, c.y - Math.cos(a * R) * rad); cx.lineTo(c.x + Math.sin(a * R) * r2, c.y - Math.cos(a * R) * r2); cx.strokeStyle = `rgba(${RCOL},.35)`; cx.stroke() }
  const ang = reduce ? 0 : ((ts % PERIOD) / PERIOD) * 360;
  if (!reduce && cx.createConicGradient) {
    const g = cx.createConicGradient((ang - 90) * R - 1.1, c.x, c.y);
    g.addColorStop(0, `rgba(${RCOL},0)`); g.addColorStop(.17, `rgba(${RCOL},.16)`); g.addColorStop(.175, `rgba(${RCOL},0)`); g.addColorStop(1, `rgba(${RCOL},0)`);
    cx.fillStyle = g; cx.beginPath(); cx.arc(c.x, c.y, rad, 0, 7); cx.fill();
    cx.beginPath(); cx.moveTo(c.x, c.y); cx.lineTo(c.x + Math.sin(ang * R) * rad, c.y - Math.cos(ang * R) * rad); cx.strokeStyle = `rgba(${RCOL},.8)`; cx.lineWidth = 1.5; cx.shadowColor = `rgb(${RCOL})`; cx.shadowBlur = 12; cx.stroke(); cx.shadowBlur = 0;
  }
  for (const t of view) {
    if (t.areaOnly) continue; const col = TM(t.type).c, isSel = selected === t.id;
    const pts = (t.trail || []).map(q => map.latLngToContainerPoint([q.lat, q.lon])); const here = map.latLngToContainerPoint(t.pos); pts.push(here);
    if (pts.length > 1) {
      cx.lineCap = "round"; cx.lineJoin = "round";
      for (let i = 1; i < pts.length; i++) {
        const f = i / (pts.length - 1); cx.beginPath(); cx.moveTo(pts[i - 1].x, pts[i - 1].y); cx.lineTo(pts[i].x, pts[i].y);
        cx.strokeStyle = col; cx.globalAlpha = .15 + .75 * f; cx.lineWidth = (isSel ? 2 : 1) + 2.4 * f; cx.shadowColor = col; cx.shadowBlur = 12 * f; cx.stroke()
      }
      for (let i = 0; i < pts.length - 1; i++) { cx.beginPath(); cx.arc(pts[i].x, pts[i].y, 1.8, 0, 7); cx.fillStyle = col; cx.globalAlpha = .5; cx.fill() }
      cx.globalAlpha = 1; cx.shadowBlur = 0
    }
    if (t.hdg != null && !t.advisory) {
      const len = t.speed ? t.speed / (isSel ? 2 : 6) : 25, ahead = map.latLngToContainerPoint(move(t.pos, t.hdg, len));
      cx.setLineDash([4, 6]); cx.beginPath(); cx.moveTo(here.x, here.y); cx.lineTo(ahead.x, ahead.y); cx.strokeStyle = col; cx.globalAlpha = isSel ? .95 : .65; cx.lineWidth = isSel ? 1.8 : 1.2; cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
      if (isSel && t.speed) for (let m = 5; m <= 30; m += 5) {
        const q = map.latLngToContainerPoint(move(t.pos, t.hdg, t.speed * m / 60)); cx.beginPath(); cx.arc(q.x, q.y, m % 10 ? 2.5 : 3.5, 0, 7); cx.fillStyle = col; cx.fill();
        if (m % 10 === 0) { cx.fillStyle = "#fff"; cx.font = "600 10px 'JetBrains Mono',monospace"; cx.fillText(`+${m} min`, q.x + 7, q.y + 3) }
      }
    }
    if (!reduce) {
      const ta = (Math.atan2(here.x - c.x, -(here.y - c.y)) / R + 360) % 360, since = ((ang - ta) + 360) % 360;
      if (since < 120) { const a = 1 - since / 120; cx.beginPath(); cx.arc(here.x, here.y, 8 + 18 * (1 - a), 0, 7); cx.fillStyle = col; cx.globalAlpha = .35 * a; cx.shadowColor = col; cx.shadowBlur = 20; cx.fill(); cx.globalAlpha = 1; cx.shadowBlur = 0 }
    }
  }
}
requestAnimationFrame(frame);

/* ---------- budowa widoku ---------- */
function deadReckon(t, now) {
  const p = [t.lat, t.lon];
  if (mode === "hist" || t.areaOnly || !t.velocity || !t.velocity.speedKmh) return { pos: p, hdg: t.heading ?? null, speed: t.velocity && t.velocity.speedKmh || null };
  const t0 = Date.parse(t.confirmedAt || t.updatedAt); const h = Math.min(15, Math.max(0, (now - t0) / 60000)) / 60;
  const b = t.velocity.bearingDeg ?? t.heading; return { pos: b == null ? p : move(p, b, t.velocity.speedKmh * h), hdg: b ?? null, speed: t.velocity.speedKmh }
}
function sourceThreats() { return mode === "hist" ? histThreatsAt(histTime) : [...live.threats.values()] }
function recompute() {
  const now = mode === "hist" ? histTime : Date.now(); view = [];
  for (const t of sourceThreats()) {
    if (t.status === "resolved" || t.lat == null) continue; const d = deadReckon(t, now);
    const o = { ...t, pos: d.pos, hdg: d.hdg, speed: d.speed, type: TYPES[t.type] ? t.type : "unknown" };
    if (!t.areaOnly) { o.dist = inPL(o.pos) ? 0 : distPL(o.pos); o.inPL = o.dist === 0; o.toPL = o.advisory ? null : towardPL(o.pos, o.hdg) } else o.dist = null;
    view.push(o)
  }
  view.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  if (selected && !view.some(o => o.id === selected)) select(null, true);
  renderMarkers(); renderList(); renderStats(); renderDetail(); evalLevel();
}
const fmtAgo = iso => { const s = ((mode === "hist" ? histTime : Date.now()) - Date.parse(iso)) / 1000; if (!isFinite(s)) return ""; if (s < 60) return "przed chwilą"; if (s < 3600) return Math.round(s / 60) + " min temu"; return Math.round(s / 3600) + " godz. temu" };
const place = o => [o.locality, o.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");

/* ---------- znaczniki ---------- */
const markers = new Map(); const tkLayer = L.layerGroup().addTo(map);
const alertLayer = L.layerGroup().addTo(map), areaLayer = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map);
function tipHTML(o) {
  const m = TM(o.type);
  return `<b style="color:${m.c}">${m.n}${o.count > 1 ? " ×" + o.count : ""}</b><br>${esc(place(o))}` + (o.areaOnly ? `<br><span style="color:#ffb020">Brak dokładnej pozycji: podano tylko obwód.</span>` :
    `<br>${o.inPL ? '<b style="color:#ff3b4e">NAD POLSKĄ</b>' : "Do granicy RP: <b>" + Math.round(o.dist) + " km</b>"}${o.toPL ? '<br><b style="color:#ff3b4e">Kurs w stronę Polski</b>' : ""}`) + `<br><span style="color:#93a3bf">Kliknij, aby zobaczyć szczegóły</span>`
}
function renderMarkers() {
  const seen = new Set(); areaLayer.clearLayers();
  for (const o of view) {
    const m = TM(o.type);
    if (o.areaOnly) { const ob = OBL_BY_NAME.get(o.region); if (ob) L.polygon(ob.g, { renderer: svgR, className: "area-hatch", color: m.c, weight: 2, dashArray: "6 6", fillColor: m.c, fillOpacity: .1 }).bindTooltip(tipHTML(o), { className: "tip", sticky: true }).on("click", () => select(o.id)).addTo(areaLayer); continue }
    seen.add(o.id); const hot = !o.advisory && (o.inPL || o.dist < thr || o.toPL);
    const h = o.hdg ?? 0, lbl = `${m.s}${o.dist < 600 ? " · " + (o.inPL ? "NAD RP" : Math.round(o.dist) + " km") : ""}`;
    const html = `<div class="tk${hot ? " hot" : ""}${o.advisory ? " adv" : ""}${o.status === "stale" ? " stale" : ""}${o.hdg == null ? " nohdg" : ""}${selected === o.id ? " sel" : ""}" style="--c:${m.c};--h:${h}deg;--r:${o.hdg == null ? 0 : h}deg"><div class="cone"></div><div class="plate"><svg viewBox="0 0 24 24">${SVG[o.type]}</svg></div>${o.count > 1 ? `<span class="cnt">${o.count}</span>` : ""}<em>${lbl}</em></div>`;
    let mk = markers.get(o.id);
    if (!mk) { mk = L.marker(o.pos, { keyboard: false, riseOnHover: true, icon: L.divIcon({ className: "", html, iconSize: [46, 46], iconAnchor: [23, 23] }) }).bindTooltip("", { className: "tip", direction: "top", offset: [0, -18] }).on("click", () => select(o.id)).addTo(tkLayer); mk._h = html; markers.set(o.id, mk) }
    else { mk.setLatLng(o.pos); if (mk._h !== html) { mk.setIcon(L.divIcon({ className: "", html, iconSize: [46, 46], iconAnchor: [23, 23] })); mk._h = html } }
    mk.setZIndexOffset(selected === o.id ? 2000 : hot ? 1000 : 0);
    mk.setTooltipContent(tipHTML(o))
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { tkLayer.removeLayer(mk); markers.delete(id) }
  selLayer.clearLayers();
  const s = view.find(o => o.id === selected);
  if (s && !s.areaOnly && s.uncertaintyKm) L.circle(s.pos, { radius: s.uncertaintyKm * 1000, renderer: svgR, className: "unc", color: TM(s.type).c, weight: 1.2, dashArray: "4 5", fillColor: TM(s.type).c, fillOpacity: .07, interactive: false }).addTo(selLayer);
}
function select(id, silent) {
  selected = id;
  if (!silent) {
    const o = view.find(x => x.id === id);
    if (o) { userMoved = true; if (o.areaOnly) { const ob = OBL_BY_NAME.get(o.region); if (ob) map.flyToBounds(L.polygon(ob.g).getBounds(), { duration: .8 }) } else map.flyTo(o.pos, Math.max(map.getZoom(), 7.25), { duration: .8 }) }
    if (mobile() && id) setTimeout(() => $("detail-sec").scrollIntoView({ behavior: "smooth", block: "start" }), 900);
    renderMarkers(); renderList();
  }
  renderDetail();
}
map.on("click", () => { if (selected) select(null) });

/* ---------- panel ---------- */
function renderList() {
  const pts = view.filter(o => !o.areaOnly), area = view.filter(o => o.areaOnly);
  $("n-list").textContent = (live.haveData || mode === "hist") ? `${pts.length + area.length} w powietrzu` : "—";
  if (!live.haveData && mode !== "hist") return;
  const rows = pts.slice(0, 25).map(o => {
    const m = TM(o.type), hot = !o.advisory && (o.inPL || o.dist < thr || o.toPL);
    return `<button class="it${hot ? " hot" : ""}${selected === o.id ? " sel" : ""}" data-id="${esc(o.id)}" style="--c:${m.c}"><span class="ic">${icon(o.type, o.hdg)}</span>
      <span class="t">${m.n}${o.count > 1 ? " ×" + o.count : ""}${o.inPL ? '<span class="tag pl">nad RP</span>' : o.toPL ? '<span class="tag pl">kurs na RP</span>' : ""}${o.advisory ? '<span class="tag adv">obserwacja</span>' : ""}</span>
      <span class="d">${o.inPL ? "0" : Math.round(o.dist)} km</span>
      <span class="s">${esc(o.locality || o.region || "")}${o.region && o.locality && o.locality !== o.region ? " · " + esc(o.region.replace(" область", " обл.")) : ""}${o.updatedAt ? " · " + fmtAgo(o.updatedAt) : ""}</span></button>`
  });
  for (const o of area.slice(0, 8)) { const m = TM(o.type); rows.push(`<button class="it" data-id="${esc(o.id)}" style="--c:${m.c}"><span class="ic">${icon(o.type)}</span><span class="t">${m.n}${o.count > 1 ? " ×" + o.count : ""}<span class="tag area">tylko obwód</span></span><span class="d">—</span><span class="s">${esc(o.region)}${o.updatedAt ? " · " + fmtAgo(o.updatedAt) : ""}</span></button>`) }
  $("list").innerHTML = rows.join("") || '<span class="empty">Brak aktywnych zagrożeń w powietrzu.</span>';
}
$("list").addEventListener("click", e => { const b = e.target.closest(".it"); if (b) select(b.dataset.id) });
function compass(h, c) {
  return `<svg class="compass" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" fill="rgba(0,0,0,.3)" stroke="rgba(120,170,255,.3)"/>${[0, 90, 180, 270].map((a, i) => `<text x="${28 + Math.sin(a * R) * 19}" y="${28 - Math.cos(a * R) * 19 + 3}" fill="#5f6f8c" font-size="8" font-family="JetBrains Mono" text-anchor="middle">${"NESW"[i]}</text>`).join("")}${h == null ? "" : `<path d="M28 9 32 30 28 27 24 30Z" fill="${c}" transform="rotate(${h} 28 28)"/>`}<circle cx="28" cy="28" r="2.5" fill="#eaf1fb"/></svg>`
}
function renderDetail() {
  const o = view.find(x => x.id === selected); $("detail-sec").hidden = !o; if (!o) return;
  const m = TM(o.type), conf = { low: 33, medium: 66, high: 100 }[o.confidenceLevel || o.displayConfidence] ?? null;
  const eta = o.toPL && o.speed ? Math.round(o.toPL / o.speed * 60) : null;
  const el = $("detail"); el.style.setProperty("--c", m.c);
  el.innerHTML = `<div class="dhead"><div class="big">${icon(o.type, o.hdg)}</div><div><h3>${m.n}${o.count > 1 ? " ×" + o.count : ""}</h3><p>${esc(place(o)) || "—"}</p></div><button class="x" id="d-close" aria-label="Zamknij szczegóły">×</button></div>
    ${o.inPL ? `<div class="chips"><span class="chip">Nad Polską, okolice m. ${esc(nearestPLCity(o.pos))}</span></div>` : o.toPL ? `<div class="chips"><span class="chip">Kurs w stronę Polski${eta != null ? `, granica za ok. ${eta} min` : ""}</span></div>` : ""}
    <div class="row" style="flex-wrap:nowrap;gap:12px">${compass(o.hdg, m.c)}<div class="kv" style="flex:1">
      <div><span>Do granicy</span><b>${o.areaOnly ? "—" : o.inPL ? "0 km" : Math.round(o.dist) + " km"}</b></div>
      <div><span>Kurs</span><b>${o.hdg == null ? "—" : Math.round(o.hdg) + "° " + dirName(o.hdg)}</b></div>
      <div><span>Prędkość</span><b>${o.speed ? Math.round(o.speed) + " km/h" : "—"}</b></div>
      <div><span>Niepewność</span><b>${o.uncertaintyKm != null ? "±" + o.uncertaintyKm + " km" : "—"}</b></div>
      <div><span>Źródła</span><b>${o.sourceCount ?? "—"}</b></div>
      <div><span>Trasa</span><b>${(o.trail || []).length} pkt</b></div></div></div>
    ${conf != null ? `<div style="display:grid;gap:4px"><span class="note">Pewność danych: ${{ 33: "niska", 66: "średnia", 100: "wysoka" }[conf]}</span><div class="conf"><i style="width:${conf}%"></i></div></div>` : ""}
    ${o.explanationShort ? `<p class="note">${esc(o.explanationShort)}</p>` : ""}
    ${o.areaOnly ? '<p class="note">Źródła podały tylko obwód, bez miejscowości. Dlatego obiekt nie ma punktu na mapie.</p>' : ""}
    <p class="src">${mode === "hist" ? "Stan z godz. " + hm(histTime) : o.updatedAt ? "Aktualizacja: " + fmtAgo(o.updatedAt) : ""}</p>`;
  $("d-close").onclick = () => select(null);
}
function setStat(id, v) { const el = $(id); el.textContent = v; el.parentElement.classList.toggle("zero", v === 0 || v === "—") }
function renderStats() {
  const c = t => view.filter(o => o.type === t && !o.advisory).reduce((a, o) => a + (o.count > 1 ? o.count : 1), 0);
  setStat("s-uav", c("uav") + c("recon")); setStat("s-mis", c("missile")); setStat("s-bal", c("ballistic")); setStat("s-kab", c("kab"));
  const near = view.find(o => o.dist != null && !o.advisory); setStat("s-near", near ? (near.inPL ? "NAD RP" : Math.round(near.dist) + " km") : "—")
}

/* ---------- alarmy ---------- */
// wspólny format: { items:[{key,kind,name,oblast,since}], border:[nazwy] }
function normLiveAlerts(a) {
  if (!a) return { items: [], border: [] };
  const items = [...(a.raions || []).map(x => ({ ...x, kind: "r" })), ...(a.oblasts || []).map(x => ({ ...x, kind: "o" }))];
  return { items, border: items.filter(x => BORDER_OBL.includes(x.oblast) || BORDER_OBL.includes(x.name)).map(x => x.name) }
}
function normCompact(c) {
  if (!c) return { items: [], border: [] };
  return { items: [...(c.r || []).map(k => ({ key: k, kind: "r", name: (RAION.get(k) || {}).n || k, oblast: (RAION.get(k) || {}).o })), ...(c.o || []).map(k => ({ key: k, kind: "o", name: (OBL.get(k) || {}).n || k }))], border: c.b || [] }
}
let lastAlertsKey = "";
function renderAlerts(n) {
  const key = n.items.map(i => i.kind + i.key).join("|") + "#" + n.border.join("|");
  if (key !== lastAlertsKey) {
    lastAlertsKey = key; alertLayer.clearLayers();
    for (const a of n.items) {
      const g = a.kind === "r" ? RAION.get(a.key) : OBL.get(a.key); if (!g) continue;
      L.polygon(g.g, { renderer: svgR, className: a.kind === "r" ? "al-raion" : "al-obl", color: "#ff3b4e", weight: a.kind === "r" ? 1 : 1.4, opacity: .9, fillColor: "#ff3b4e", fillOpacity: a.kind === "r" ? .26 : .22 })
        .bindTooltip(`<b>${esc(a.name)}</b>${a.oblast && a.oblast !== a.name ? "<br>" + esc(a.oblast) : ""}${a.since ? "<br>Alarm od " + hm(a.since) : a.kind === "o" ? "<br>Alarm w całym obwodzie" : ""}`, { className: "tip", sticky: true }).addTo(alertLayer)
    }
  }
  setStat("s-obl", new Set(n.items.map(a => a.kind === "o" ? a.name : (a.oblast || (RAION.get(a.key) || {}).o || a.key))).size);
  $("n-al").textContent = n.border.length ? n.border.length + " aktywne" : "brak";
  $("al-list").innerHTML = n.border.length ? n.border.map(b => `<span class="chip">${esc(b)}</span>`).join("") : '<span class="empty">Brak alarmów w obwodach graniczących z Polską (wołyński, lwowski, zakarpacki).</span>';
  curBorder = n.border; evalLevel();
}
let curBorder = [];
const refreshAlerts = () => renderAlerts(mode === "hist" ? normCompact(histAlertsAt(histTime)) : normLiveAlerts(live.alerts));

/* ---------- wiadomości ---------- */
function renderTicker() {
  if (!messages.length) return;
  const items = messages.slice(0, 25).map(m => `<span><time>${hm(m.date)}</time><b>${esc(m.channel)}</b>${esc(String(m.text).replace(/\s+/g, " ").slice(0, 180))}</span>`).join("");
  const rail = $("rail"); rail.innerHTML = items + items; rail.style.setProperty("--dur", Math.max(40, messages.slice(0, 25).reduce((a, m) => a + Math.min(180, String(m.text).length), 0) / 9) + "s")
}

/* ---------- poziom zagrożenia, dźwięk, powiadomienia na ekranie ---------- */
let soundOn = false, actx = null, lastLevel = -1; const warned = new Set();
function beep(n = 3) { if (!soundOn || !actx) return; const t = actx.currentTime; for (let i = 0; i < n; i++) { const o = actx.createOscillator(), g = actx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(960, t + i * .4); o.frequency.exponentialRampToValueAtTime(540, t + i * .4 + .32); g.gain.setValueAtTime(.06, t + i * .4); g.gain.exponentialRampToValueAtTime(.001, t + i * .4 + .36); o.connect(g).connect(actx.destination); o.start(t + i * .4); o.stop(t + i * .4 + .38) } }
let swReg = null;
async function notify(title, body, tag) {
  beep();
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opt = { body, tag, renotify: true, icon: "icons/icon-192.png", badge: "icons/badge.png", vibrate: [300, 100, 300, 100, 600] };
    if (swReg) await swReg.showNotification(title, opt); else new Notification(title, opt)
  } catch (e) { }
}
$("b-snd").onclick = e => { soundOn = !soundOn; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume() } catch (_) { } e.currentTarget.setAttribute("aria-pressed", soundOn); e.currentTarget.textContent = "Dźwięk: " + (soundOn ? "włączony" : "wyłączony"); if (soundOn) beep(1) };
setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString("pl-PL") }, 1000);
function evalLevel() {
  const act = view.filter(o => !o.areaOnly && !o.advisory && o.status !== "stale");
  const inside = act.find(o => o.inPL), close = act.find(o => o.dist < thr), toward = act.find(o => o.toPL && o.dist < thr * 2);
  let l = 0; if (curBorder.length || close || toward) l = 1; if (inside || (close && close.toPL)) l = 2;
  $("level").dataset.l = l; $("level-t").textContent = ["niskie", "podwyższone", "wysokie"][l];
  if (mode !== "live" || !live.haveData) return;
  for (const o of act) {
    const key = o.id + (o.inPL ? ":in" : ":near"); if (!(o.inPL || o.dist < thr) || warned.has(key)) continue; warned.add(key);
    notify(o.inPL ? `🚨 ${TM(o.type).n} nad Polską` : `⚠️ ${TM(o.type).n} ${Math.round(o.dist)} km od granicy`, o.inPL ? `Okolice m. ${nearestPLCity(o.pos)}.` : `${place(o)}${o.toPL ? ". Kurs w stronę Polski" : ""}.`, (o.inPL ? "in-" : "near-") + o.id)
  }
  if (lastLevel !== -1 && l > lastLevel) beep(l === 2 ? 5 : 2); lastLevel = l
}

/* ---------- dane na żywo ---------- */
function setLive(state, text) { $("live").className = "live " + state; $("livetxt").textContent = text }
function stamp(src) { $("src").textContent = `Źródło: ${src} · ${new Date().toLocaleTimeString("pl-PL")}` }
function applySnapshot(list) { live.threats.clear(); for (const t of list || []) live.threats.set(t.id, t); live.haveData = true; if (mode === "live") recompute() }
function fetchJSON(url, ms = 12000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, cache: "no-store" }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() }).finally(() => clearTimeout(t)) }
let source = "none", wsRetry = 0;
function liveLabel() { if (mode === "live") setLive("on", source === "worker" ? "Na żywo · przez serwer" : "Na żywo · NEPTUN") }
function startWS() {
  return new Promise(res => {
    let ws, done = false; const fail = () => { if (!done) { done = true; res(false) } };
    try { ws = new WebSocket("wss://neptun.in.ua/api/v1/stream") } catch (e) { return fail() }
    const to = setTimeout(() => { try { ws.close() } catch (e) { } fail() }, 8000);
    ws.onmessage = e => {
      let env; try { env = JSON.parse(e.data) } catch (_) { return }
      if (env.type === "snapshot") { clearTimeout(to); applySnapshot(env.data && env.data.threats); if (env.data && env.data.alerts) { live.alerts = env.data.alerts; if (mode === "live") refreshAlerts() } if (!done) { done = true; wsRetry = 0; res(true) } }
      else if (env.type === "upsert" && env.data && env.data.id) { live.threats.set(env.data.id, env.data); if (mode === "live") recompute() }
      else if (env.type === "remove" && env.data) { live.threats.delete(env.data.id); if (mode === "live") recompute() }
      else if (env.type === "alerts" && env.data) { live.alerts = env.data; if (mode === "live") refreshAlerts() }
      stamp("NEPTUN, WebSocket na żywo")
    };
    ws.onerror = fail;
    ws.onclose = () => { if (done && source === "ws") { setLive("err", "Rozłączono, ponawiam…"); source = "none"; setTimeout(connect, Math.min(30000, 3000 * ++wsRetry)) } else fail() }
  })
}
let pollTimer = null;
async function pollThreats() {
  try {
    if (source === "worker") { const j = await fetchJSON(WORKER + "/api/live"); applySnapshot(j.threats); if (j.alerts) { live.alerts = j.alerts; if (mode === "live") refreshAlerts() } stamp("kopia z serwera, co 15 s") }
    else { applySnapshot((await fetchJSON(API + "/api/v1/threats")).threats); stamp("NEPTUN, co 10 s") }
    liveLabel()
  } catch (e) { if (mode === "live") setLive("err", "Błąd pobierania, ponawiam") }
}
async function connect() {
  if (mode === "live") setLive("", "Łączenie z NEPTUN…");
  clearInterval(pollTimer);
  if (await startWS()) { source = "ws"; liveLabel(); return }
  try { applySnapshot((await fetchJSON(API + "/api/v1/threats")).threats); source = "rest"; liveLabel(); stamp("NEPTUN, co 10 s"); pollTimer = setInterval(() => { if (!document.hidden) pollThreats() }, 10000); return } catch (e) { }
  if (WORKER) try { source = "worker"; await pollThreats(); if (live.haveData) { pollTimer = setInterval(() => { if (!document.hidden) pollThreats() }, 15000); return } } catch (e) { }
  source = "none"; setLive("err", "Brak połączenia, ponawiam za 30 s"); setTimeout(connect, 30000)
}
async function pollAlerts() { if (source === "worker") return; try { live.alerts = await fetchJSON(API + "/api/v1/alerts"); if (mode === "live") refreshAlerts() } catch (e) { } }
async function pollMsgs() { try { const j = await fetchJSON(API + "/api/v1/messages"); messages = j.messages || []; renderTicker() } catch (e) { } }

/* ---------- oś czasu ---------- */
// migawka: [t, [[id,typ,lat,lon,kurs,liczba,flagi,miejsce], ...]]; alarmy: [t, {r:[], o:[], b:[]}]
const hist = { snaps: [], alerts: [], from: "none", loadedAt: 0, hours: +store.get("hours", 6) };
const local = { snaps: [], alerts: [] };
$("t-hours").value = String(hist.hours);
function compactNow() {
  const rows = [...live.threats.values()].filter(x => x.status !== "resolved" && x.lat != null).map(x => [x.id, x.type, +(+x.lat).toFixed(3), +(+x.lon).toFixed(3), x.heading ?? null, x.count || 0, (x.areaOnly ? 1 : 0) | (x.advisory ? 2 : 0) | (x.status === "stale" ? 4 : 0), x.locality || x.region || ""]);
  const n = normLiveAlerts(live.alerts);
  return { rows, al: { r: n.items.filter(i => i.kind === "r").map(i => i.key).sort(), o: n.items.filter(i => i.kind === "o").map(i => i.key).sort(), b: n.border.slice().sort() } }
}
setInterval(() => {   // zapis lokalny co minutę, gdy nie ma serwera
  if (!live.haveData) return; const t = Math.floor(Date.now() / 60000) * 60000, c = compactNow();
  if (!local.snaps.length || local.snaps[local.snaps.length - 1][0] !== t) local.snaps.push([t, c.rows]);
  const la = local.alerts[local.alerts.length - 1]; if (!la || JSON.stringify(la[1]) !== JSON.stringify(c.al)) local.alerts.push([t, c.al]);
  while (local.snaps.length && local.snaps[0][0] < Date.now() - 24 * 3600e3) local.snaps.shift();
  if (hist.from !== "worker") useLocal(); drawTrack();
}, 20000);
function useLocal() { hist.snaps = local.snaps; hist.alerts = local.alerts; hist.from = "local" }
async function loadHistory(force) {
  if (!WORKER) { useLocal(); drawTrack(); return }
  if (!force && Date.now() - hist.loadedAt < 120000 && hist.from === "worker") return;
  try {
    const step = hist.hours > 12 ? 3 : hist.hours > 6 ? 2 : 1;
    const j = await fetchJSON(`${WORKER}/api/history?hours=${hist.hours}&step=${step}`, 30000);
    if (j.snaps && j.snaps.length) { hist.snaps = j.snaps; hist.alerts = j.alerts || []; hist.from = "worker"; hist.loadedAt = Date.now() } else useLocal();
  } catch (e) { useLocal() }
  computeBars(); drawTrack();
}
function idxAt(arr, t) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= t) { r = m; lo = m + 1 } else hi = m - 1 } return r }
function histThreatsAt(t) {
  const i = idxAt(hist.snaps, t); if (i < 0) return [];
  const [st, rows] = hist.snaps[i]; const out = [];
  const back = []; for (let j = i - 1; j >= 0 && st - hist.snaps[j][0] <= 45 * 60000; j--) back.push(hist.snaps[j]);
  for (const r of rows) {
    const [id, type, lat, lon, hdg, count, f, loc] = r;
    const trail = []; for (let k = back.length - 1; k >= 0; k--) { const q = back[k][1].find(x => x[0] === id); if (q && !(q[6] & 1)) { const l = trail[trail.length - 1]; if (!l || l.lat !== q[2] || l.lon !== q[3]) trail.push({ lat: q[2], lon: q[3] }) } }
    out.push({ id, type, lat, lon, heading: hdg, count, areaOnly: !!(f & 1), advisory: !!(f & 2), status: f & 4 ? "stale" : "active", locality: loc, region: (f & 1) ? loc : "", trail })
  }
  return out
}
function histAlertsAt(t) { const i = idxAt(hist.alerts, t); return i < 0 ? null : hist.alerts[i][1] }
const trange = () => { const end = Date.now(); return [end - hist.hours * 3600e3, end] };
let bars = [];
function computeBars() {
  const [a, b] = trange(), n = Math.max(24, Math.min(144, hist.hours * 12)), w = (b - a) / n; bars = Array.from({ length: n }, () => ({ v: 0, near: false, al: false }));
  for (const [t, rows] of hist.snaps) {
    if (t < a) continue; const k = Math.min(n - 1, Math.floor((t - a) / w)); let v = 0, near = false;
    for (const r of rows) { if (r[6] & 3) continue; v += r[5] > 1 ? r[5] : 1; if (r[3] < 26.6 && r[2] > 48.2 && r[2] < 55.2) near = true }
    bars[k].v = Math.max(bars[k].v, v); bars[k].near = bars[k].near || near
  }
  for (let i = 0; i < hist.alerts.length; i++) {
    const [t, c] = hist.alerts[i], t2 = i + 1 < hist.alerts.length ? hist.alerts[i + 1][0] : b;
    if (!(c.b || []).length) continue; for (let k = 0; k < n; k++) { const s = a + k * w; if (s + w > t && s < t2) bars[k].al = true }
  }
}
const tcv = $("t-canvas"), tcx = tcv.getContext("2d");
function drawTrack() {
  const r = tcv.getBoundingClientRect(); if (!r.width) return; const d = Math.min(2, devicePixelRatio || 1);
  if (tcv.width !== Math.round(r.width * d)) { tcv.width = Math.round(r.width * d); tcv.height = Math.round(r.height * d) }
  tcx.setTransform(d, 0, 0, d, 0, 0); tcx.clearRect(0, 0, r.width, r.height);
  const [a, b] = trange(), W = r.width, H = r.height, base = H - 12;
  tcx.fillStyle = "rgba(255,255,255,.04)"; tcx.fillRect(0, 4, W, base - 4);
  const max = Math.max(4, ...bars.map(x => x.v)), bw = W / Math.max(1, bars.length);
  bars.forEach((x, i) => {
    if (x.al) { tcx.fillStyle = "rgba(255,59,78,.85)"; tcx.fillRect(i * bw, 4, bw, 2.5) }
    if (!x.v) return; const h = Math.max(2, (base - 10) * x.v / max);
    tcx.fillStyle = x.near ? "rgba(255,59,78,.85)" : mode === "hist" ? "rgba(255,190,80,.55)" : "rgba(56,225,255,.5)"; tcx.fillRect(i * bw + .5, base - h, Math.max(1, bw - 1), h)
  });
  if (!hist.snaps.length) { tcx.fillStyle = "#5f6f8c"; tcx.font = "500 11px 'IBM Plex Sans',sans-serif"; tcx.fillText(WORKER ? "Wczytywanie historii…" : "Historia zapisuje się od otwarcia strony (co minutę)", 8, base / 2 + 6) }
  tcx.fillStyle = "#5f6f8c"; tcx.font = "500 9px 'JetBrains Mono',monospace";
  const stepH = hist.hours > 12 ? 3 : hist.hours > 6 ? 2 : 1, first = Math.ceil(a / 3600e3 / stepH) * stepH * 3600e3;
  const every = Math.max(1, Math.ceil(40 / (W / ((b - a) / (stepH * 3600e3))))); let n = 0;
  for (let t = first; t < b; t += stepH * 3600e3, n++) { const x = (t - a) / (b - a) * W; tcx.fillRect(x, base, 1, 4); if (n % every === 0) tcx.fillText(hm(t), Math.min(W - 26, x + 3), H - 1) }
  const cur = mode === "hist" ? histTime : b, x = (cur - a) / (b - a) * W;
  tcx.fillStyle = mode === "hist" ? "#ffc24a" : "#3be39b"; tcx.fillRect(Math.min(W - 2, Math.max(0, x - 1)), 0, 2, base + 2);
  tcx.beginPath(); tcx.arc(Math.min(W - 4, Math.max(4, x)), 4, 4, 0, 7); tcx.fill()
}
function setLabel() {
  const l = $("t-label");
  if (mode === "live") { l.innerHTML = `na żywo<small>${hist.from === "worker" ? "historia: serwer" : hist.from === "local" ? "historia: lokalna" : "—"}</small>`; return }
  const ago = Math.round((Date.now() - histTime) / 60000);
  l.innerHTML = `${hm(histTime)}<small>${ago < 60 ? ago + " min temu" : Math.floor(ago / 60) + " h " + (ago % 60) + " min temu"}</small>`;
  $("histtxt").textContent = `Historia · ${new Date(histTime).toLocaleString("pl-PL", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
}
function enterHist(t) {
  if (!hist.snaps.length) { toast(WORKER ? "Historia jeszcze się wczytuje." : "Historia zapisuje się od chwili otwarcia strony. Wróć za kilka minut."); goLive(); return }
  const [a] = trange(); histTime = Math.max(Math.max(a, hist.snaps[0][0]), Math.min(Date.now(), t));
  if (mode !== "hist") { mode = "hist"; document.body.classList.add("history"); $("stage").classList.add("history"); $("histflag").hidden = false; setLive("hist", "Historia (oś czasu)") }
  recompute(); refreshAlerts(); setLabel(); drawTrack()
}
function goLive() {
  stopPlay(); if (mode === "live") { setLabel(); drawTrack(); return }
  mode = "live"; $("stage").classList.remove("history"); $("histflag").hidden = true; $("t-range").value = 1000; liveLabel();
  recompute(); refreshAlerts(); setLabel(); drawTrack()
}
$("t-range").addEventListener("pointerdown", () => loadHistory());
$("t-range").addEventListener("input", e => {
  const v = +e.target.value; if (v >= 998) { goLive(); return }
  stopPlay(); const [a, b] = trange(); enterHist(a + (b - a) * v / 1000)
});
$("t-live").onclick = goLive; $("hist-back").onclick = goLive;
$("t-hours").onchange = e => { hist.hours = +e.target.value; store.set("hours", hist.hours); hist.loadedAt = 0; loadHistory(true) };
let playTimer = null;
const playIcon = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M4 2.5v11l9-5.5z"/></svg>', pauseIcon = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z"/></svg>';
function stopPlay() { clearInterval(playTimer); playTimer = null; $("t-play").innerHTML = playIcon; $("t-play").setAttribute("aria-label", "Odtwórz historię") }
$("t-play").onclick = async () => {
  if (playTimer) { stopPlay(); return }
  await loadHistory();
  if (!hist.snaps.length) { enterHist(0); return }
  const [a, b] = trange(); if (mode === "live" || histTime >= b - 60000) enterHist(Math.max(a, hist.snaps[0][0]));
  $("t-play").innerHTML = pauseIcon; $("t-play").setAttribute("aria-label", "Zatrzymaj odtwarzanie");
  playTimer = setInterval(() => {
    const sp = +$("t-speed").value; const [a2, b2] = trange(); const nt = histTime + sp * 150;
    if (nt >= b2 - 30000) { goLive(); return }
    histTime = nt; $("t-range").value = Math.round((histTime - a2) / (b2 - a2) * 1000); recompute(); refreshAlerts(); setLabel(); drawTrack()
  }, 150)
};
new ResizeObserver(() => drawTrack()).observe($("t-canvas"));
setInterval(() => { computeBars(); drawTrack(); if (mode === "hist") setLabel() }, 30000);
let toastT; function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4000) }

/* ---------- powiadomienia w tle (Web Push) ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const PREFS = ["inPL", "near", "toward", "border"];
const savedPrefs = store.get("prefs", {}); for (const k of PREFS) if (savedPrefs[k] === false) $("p-" + k).checked = false;
const prefs = () => ({ thr, ...Object.fromEntries(PREFS.map(k => [k, $("p-" + k).checked])) });
function pushStatus(text, cls = "") { const p = $("push-status"); p.textContent = text; p.className = "note " + cls }
const b64ToU8 = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)) };
async function post(path, data) { const r = await fetch(WORKER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j }
async function currentSub() { return swReg ? swReg.pushManager.getSubscription() : null }
async function showPushState() {
  const sub = await currentSub().catch(() => null);
  $("push-on").hidden = !!sub; $("push-test").hidden = !sub; $("push-off").hidden = !sub;
  if (sub) pushStatus("Włączone na tym urządzeniu. Ostrzeżenia przyjdą także przy zamkniętej aplikacji.", "ok");
}
async function initPush() {
  if (!WORKER) { $("push-on").disabled = true; pushStatus("Serwer powiadomień nie jest jeszcze skonfigurowany. Ostrzeżenia działają tylko przy otwartej stronie."); return }
  if (isIOS && !standalone) { $("ios-howto").hidden = false; $("push-on").disabled = true; pushStatus("Na iPhonie powiadomienia w tle działają tylko po dodaniu aplikacji do ekranu początkowego (iOS 16.4 lub nowszy)."); return }
  if (!pushOK) { $("push-on").disabled = true; pushStatus("Ta przeglądarka nie obsługuje powiadomień w tle. Na Androidzie użyj Chrome, na iPhonie dodaj stronę do ekranu początkowego."); return }
  await showPushState()
}
$("push-on").onclick = async () => {
  const b = $("push-on"); b.disabled = true; pushStatus("Włączanie…");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { pushStatus("Nie zezwolono na powiadomienia. Zmień to w ustawieniach przeglądarki dla tej strony.", "bad"); return }
    swReg = swReg || await navigator.serviceWorker.ready;
    const { key } = await fetchJSON(WORKER + "/api/vapid");
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await post("/api/subscribe", { subscription: sub.toJSON(), prefs: prefs() });
    await showPushState(); toast("Powiadomienia w tle włączone.");
  } catch (e) { pushStatus("Nie udało się włączyć powiadomień: " + (e && e.message || e), "bad") } finally { b.disabled = false }
};
$("push-test").onclick = async () => { try { const sub = await currentSub(); await post("/api/test", { endpoint: sub.endpoint }); pushStatus("Wysłano. Powiadomienie powinno pojawić się za kilka sekund.", "ok") } catch (e) { pushStatus("Nie udało się wysłać: " + e.message, "bad") } };
$("push-off").onclick = async () => { try { const sub = await currentSub(); if (sub) { await post("/api/unsubscribe", { endpoint: sub.endpoint }).catch(() => { }); await sub.unsubscribe() } pushStatus("Wyłączone na tym urządzeniu.") } catch (e) { pushStatus("Nie udało się wyłączyć: " + e.message, "bad") } showPushState() };
let prefT;
function prefsChanged() {
  store.set("prefs", prefs()); clearTimeout(prefT);
  prefT = setTimeout(async () => { const sub = await currentSub().catch(() => null); if (sub) post("/api/subscribe", { subscription: sub.toJSON(), prefs: prefs() }).then(() => pushStatus("Zapisano ustawienia powiadomień.", "ok")).catch(() => { }) }, 600)
}
for (const k of PREFS) $("p-" + k).onchange = prefsChanged;
$("i-thr").onchange = e => { thr = +e.target.value; store.set("thr", thr); recompute(); prefsChanged() };

/* ---------- start ---------- */
if (mobile()) $("legend").open = false;
requestAnimationFrame(() => setTimeout(() => $("stage").classList.remove("boot"), 80));
let rsT; addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(() => { map.invalidateSize(); if (!userMoved) map.fitBounds(HOME(), homePad()); drawTrack() }, 200) });
document.addEventListener("keydown", e => { if (e.key === "Escape" && selected) select(null) });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r => { swReg = r; initPush() }).catch(() => initPush()); else initPush();
connect();
pollAlerts(); pollMsgs();
setInterval(() => { if (!document.hidden) pollAlerts() }, 30000);
setInterval(() => { if (!document.hidden) pollMsgs() }, 20000);
setInterval(() => { if (live.haveData && mode === "live" && !document.hidden) recompute() }, 2000);
refreshAlerts(); setLabel(); loadHistory(); drawTrack();
