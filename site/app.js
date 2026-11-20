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
const LIGHT_TYPE = { uav: "#e0213a", recon: "#d4631a", missile: "#c77700", ballistic: "#c42aa6", kab: "#a88a00", mig31k: "#7a4fd6", unknown: "#5f6f8c" };
const themeSetting = () => document.documentElement.dataset.theme || "auto";
const isLight = () => themeSetting() === "light" || (themeSetting() === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
const TM = t => { const m = TYPES[t] || TYPES.unknown; return isLight() ? { ...m, c: LIGHT_TYPE[t] || LIGHT_TYPE.unknown } : m };
const PALS = {
  dark: { nei: { UA: "#0f1c30", BY: "#131a2b", RU: "#151829" }, land: "#0c1626", line: "#1a2840", lineX: "#2c2f48", obl: "#203152", pl: "#0e1d35", plLine: "#ffffff", glow: .08, rad: "56,225,255", hist: "255,190,80", text: "#ffffff", sub: "#cfe0f5", labelBg: "rgba(5,11,22,.85)", flow: "#ffffff", meta: "#050b16" },
  light: { nei: { UA: "#f6eef0", BY: "#eceff5", RU: "#eaecf3" }, land: "#f4f7fb", line: "#c2cede", lineX: "#cdbfc9", obl: "#d3dce8", pl: "#ffffff", plLine: "#13233d", glow: .1, rad: "3,120,150", hist: "190,110,0", text: "#0b1a2e", sub: "#33435d", labelBg: "rgba(255,255,255,.94)", flow: "#0b1a2e", meta: "#e7edf5" }
};
const P = () => isLight() ? PALS.light : PALS.dark;
const icon = (t, rot) => `<svg viewBox="0 0 24 24"${rot != null ? ` style="transform:rotate(${Math.round(rot)}deg)"` : ""}>${SVG[t] || SVG.unknown}</svg>`;
$("legend-rows").innerHTML = Object.entries(TYPES).map(([k, m]) => `<div><span style="color:${m.c}">${icon(k)}</span>${m.n}</div>`).join("");
setTimeout(() => { $("legend-rows").innerHTML += ["missile", "drone", "explosion", "debris"].map(k => `<div><span style="color:${INC[k].c}">${incIcon(k)}</span>W Polsce: ${INC[k].n.toLowerCase()}</div>`).join("") }, 0);

/* ---------- mapa ---------- */
const map = L.map("map", { zoomSnap: .25, minZoom: 4, maxZoom: 11, zoomControl: false, attributionControl: false, preferCanvas: true, maxBounds: [[40, 5], [63, 47]] });
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
const svgR = L.svg({ padding: .3 });
const HOME = () => mobile() ? [[48.4, 14.1], [54.9, 30.8]] : [[45.6, 13.8], [55.2, 38.5]];
const cssPx = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
const homePad = () => ({ paddingTopLeft: [0, (cssPx("--hud-b") || 100) + 4], paddingBottomRight: [mobile() ? 0 : innerWidth <= 1180 ? 345 : 390, mobile() ? cssPx("--peek") + cssPx("--tl") + 22 : 110] });
// wysokość górnego paska: baner i dopasowanie mapy zaczynają się pod nim
function measureHud() { const t = document.querySelector(".hud.top"); if (t) document.documentElement.style.setProperty("--hud-b", Math.round(t.getBoundingClientRect().bottom) + "px") }
measureHud(); new ResizeObserver(measureHud).observe(document.querySelector(".hud.top"));
map.fitBounds(HOME(), homePad());
let userMoved = false;
map.getContainer().addEventListener("pointerdown", () => userMoved = true);
map.getContainer().addEventListener("wheel", () => userMoved = true, { passive: true });
$("b-home").onclick = () => { userMoved = false; map.flyToBounds(HOME(), { ...homePad(), duration: .9 }) };
const zcls = () => map.getContainer().classList.toggle("lowz", map.getZoom() < 6.25); map.on("zoomend", zcls); zcls();

const base = { nei: [], obl: [], pl: [] };
for (const [k, polys] of Object.entries(G)) { if (k === "PL") continue; base.nei.push([k, L.polygon(polys, { weight: 1, fillOpacity: 1, interactive: false }).addTo(map)]) }
for (const o of UA.oblasts) base.obl.push(L.polygon(o.g, { weight: .8, fill: false, interactive: false }).addTo(map));
if (G.PL) {
  base.pl = [L.polygon(G.PL, { stroke: false, fillOpacity: 1, interactive: false }).addTo(map),
    L.polygon(G.PL, { color: "#ff3b4e", weight: 18, opacity: .08, fill: false, interactive: false }).addTo(map),
    L.polygon(G.PL, { color: "#ff3b4e", weight: 7, opacity: .18, fill: false, interactive: false }).addTo(map),
    L.polygon(G.PL, { weight: 2.6, opacity: .95, fill: false, interactive: false }).addTo(map),
    L.polygon(G.PL, { color: "#ff3b4e", weight: 1.6, opacity: 1, fill: false, interactive: false, renderer: svgR, className: "pl-march" }).addTo(map)];
}
function styleBase() {
  const p = P();
  for (const [k, l] of base.nei) l.setStyle({ color: p.nei[k] ? p.lineX : p.line, fillColor: p.nei[k] || p.land });
  for (const l of base.obl) l.setStyle({ color: p.obl });
  if (base.pl.length) { base.pl[0].setStyle({ fillColor: p.pl }); base.pl[1].setStyle({ opacity: p.glow }); base.pl[3].setStyle({ color: p.plLine }) }
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = p.meta;
}
styleBase();
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
  fastPositions(ts);
  const s = map.getSize(); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, s.x, s.y);
  const hist = mode === "hist", PP = P(), RCOL = hist ? PP.hist : PP.rad;
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
  drawAllTracks(); drawRoute(ts);
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
      cx.globalAlpha = 1; cx.shadowBlur = 0;
      if (!reduce) { cx.setLineDash([3, 13]); cx.lineDashOffset = -ts / 40; cx.beginPath(); cx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y); cx.strokeStyle = PP.flow; cx.globalAlpha = .55; cx.lineWidth = 1.3; cx.stroke(); cx.setLineDash([]); cx.lineDashOffset = 0; cx.globalAlpha = 1 }
    }
    if (t.hdg != null && !t.advisory) {
      const len = t.speed ? t.speed / (isSel ? 2 : 6) : 25, ahead = map.latLngToContainerPoint(move(t.pos, t.hdg, len));
      cx.setLineDash([4, 6]); cx.beginPath(); cx.moveTo(here.x, here.y); cx.lineTo(ahead.x, ahead.y); cx.strokeStyle = col; cx.globalAlpha = isSel ? .95 : .65; cx.lineWidth = isSel ? 1.8 : 1.2; cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
      if (isSel && t.speed) for (let m = 5; m <= 30; m += 5) {
        const q = map.latLngToContainerPoint(move(t.pos, t.hdg, t.speed * m / 60)); cx.beginPath(); cx.arc(q.x, q.y, m % 10 ? 2.5 : 3.5, 0, 7); cx.fillStyle = col; cx.fill();
        if (m % 10 === 0) { cx.fillStyle = PP.text; cx.font = "600 10px 'JetBrains Mono',monospace"; cx.fillText(`+${m} min`, q.x + 7, q.y + 3) }
      }
    }
    if (!reduce) {
      const ta = (Math.atan2(here.x - c.x, -(here.y - c.y)) / R + 360) % 360, since = ((ang - ta) + 360) % 360;
      if (since < 120) { const a = 1 - since / 120; cx.beginPath(); cx.arc(here.x, here.y, 8 + 18 * (1 - a), 0, 7); cx.fillStyle = col; cx.globalAlpha = .35 * a; cx.shadowColor = col; cx.shadowBlur = 20; cx.fill(); cx.globalAlpha = 1; cx.shadowBlur = 0 }
    }
  }
}
requestAnimationFrame(frame);
/* pełna trasa wybranego obiektu i animacja lotu */
let route = null, replay = null;
const obs = new Map();        // pozycje zaobserwowane od otwarcia strony: id -> [[t,lat,lon]]
let histIndex = new Map();    // z historii: id -> [[t,lat,lon]]
function recordObs(t) {
  if (!t || t.areaOnly || t.lat == null) return;
  const a = obs.get(t.id) || [], l = a[a.length - 1], tt = Date.parse(t.updatedAt) || Date.now();
  if (!l || km([l[1], l[2]], [t.lat, t.lon]) > .3) { a.push([tt, t.lat, t.lon]); if (a.length > 120) a.shift(); obs.set(t.id, a) }
}
let histMeta = new Map();
function buildHistIndex() {
  histIndex = new Map(); histMeta = new Map();
  for (const [t, rows] of hist.snaps) for (const r of rows) {
    if (r[6] & 1) continue; const a = histIndex.get(r[0]) || []; const l = a[a.length - 1]; if (!l || l[1] !== r[2] || l[2] !== r[3]) a.push([t, r[2], r[3]]); histIndex.set(r[0], a);
    const m = histMeta.get(r[0]) || { type: r[1], count: 0, first: t, loc: r[7] }; m.last = t; m.count = Math.max(m.count, r[5] || 0); if (r[7]) m.loc = r[7]; histMeta.set(r[0], m)
  }
  renderFlights()
}
function flightList() {
  const out = [];
  const cand = [...histIndex].filter(([, pts]) => pts.length >= 2).sort((x, y) => y[1][y[1].length - 1][0] - x[1][x[1].length - 1][0]).slice(0, 40);
  for (const [id] of cand) {
    const all = routeFor(id); if (all.length < 3) continue;
    let len = 0, minD = 1e9; for (let i = 1; i < all.length; i++) len += km([all[i - 1][1], all[i - 1][2]], [all[i][1], all[i][2]]);
    const step = Math.max(1, Math.floor(all.length / 12));
    for (let i = 0; i < all.length; i += step) { const p = [all[i][1], all[i][2]], c = km(p, [51.9, 19.1]); minD = Math.min(minD, c > 900 ? c - 330 : distPL(p)) }
    const m = histMeta.get(id) || {};
    out.push({ id, pts: all, type: TYPES[m.type] ? m.type : "unknown", count: m.count, loc: m.loc, first: all[0][0], last: all[all.length - 1][0], len, minD })
  }
  return out.sort((a, b) => b.last - a.last)
}
function renderFlights() {
  const fl = flightList(); $("fl-n").textContent = fl.length ? fl.length + " tras" : "—";
  if (!fl.length) { $("flights").innerHTML = `<span class="empty">${hist.snaps.length ? "Za mało pozycji, by narysować trasy. Trasy pojawią się, gdy obiekty będą w powietrzu dłużej niż kilka minut." : "Historia jest pusta. Serwer zapisuje pozycje co minutę od chwili wdrożenia; bez serwera historia zbiera się od otwarcia strony."}</span>`; return }
  $("flights").innerHTML = fl.slice(0, 30).map(f => { const m = TM(f.type); return `<div class="fl" style="--c:${m.c}"><span class="ic">${icon(f.type)}</span><b>${m.n}${f.count > 1 ? " ×" + f.count : ""}</b><span>${hm(f.first)}–${hm(f.last)} · ${Math.round(f.len)} km trasy · ${f.minD < 1 ? "nad Polską" : "min. " + Math.round(f.minD) + " km od RP"}${f.loc ? " · " + esc(translit(f.loc)) : ""}</span><button class="btn pri" data-id="${esc(f.id)}">▶</button></div>` }).join("")
}
$("flights").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (!b) return; const f = flightList().find(x => x.id === b.dataset.id); if (!f) return; selected = null; renderDetail(); route = { id: f.id, type: f.type, pts: f.pts }; startReplay(); if (mobile()) setSheet("peek") });
let allTracks = !!store.get("allTracks", false); $("all-tracks").checked = allTracks;
$("all-tracks").onchange = e => { allTracks = e.target.checked; store.set("allTracks", allTracks) };
function drawAllTracks() {
  if (!allTracks || !histIndex.size) return;
  const [a] = trange();
  for (const [id, pts] of histIndex) {
    const P = pts.filter(p => p[0] >= a); if (P.length < 2) continue; const col = TM((histMeta.get(id) || {}).type).c;
    const Q = P.map(p => map.latLngToContainerPoint([p[1], p[2]]));
    cx.beginPath(); cx.moveTo(Q[0].x, Q[0].y); for (const q of Q) cx.lineTo(q.x, q.y); cx.strokeStyle = col; cx.globalAlpha = .42; cx.lineWidth = 1.6; cx.stroke();
    const e = Q[Q.length - 1], f = Q[Q.length - 2], ang = Math.atan2(e.y - f.y, e.x - f.x);
    cx.save(); cx.translate(e.x, e.y); cx.rotate(ang); cx.beginPath(); cx.moveTo(4, 0); cx.lineTo(-5, 4); cx.lineTo(-5, -4); cx.closePath(); cx.fillStyle = col; cx.globalAlpha = .75; cx.fill(); cx.restore(); cx.globalAlpha = 1
  }
}
function mergedPts(t, since) {
  const pts = [];
  for (const q of t.trail || []) { const tt = Date.parse(q.t); pts.push([isFinite(tt) ? tt : 0, q.lat, q.lon]) }
  for (const p of histIndex.get(t.id) || []) if (p[0] >= since) pts.push(p);
  for (const p of obs.get(t.id) || []) if (p[0] >= since) pts.push(p);
  pts.sort((a, b) => a[0] - b[0]);
  const out = []; for (const p of pts) { const l = out[out.length - 1]; if (!l || km([l[1], l[2]], [p[1], p[2]]) > .3) out.push(p) }
  // ostatni punkt to bieżąca pozycja: nie dubluj go w trasie
  if (out.length && km([out[out.length - 1][1], out[out.length - 1][2]], [t.lat, t.lon]) < .3) out.pop();
  return out
}
function routeFor(id) {
  const pts = [];
  for (const p of histIndex.get(id) || []) pts.push(p);
  for (const p of obs.get(id) || []) pts.push(p);
  const lt = live.threats.get(id);
  if (lt && !lt.areaOnly) { for (const q of lt.trail || []) { const t = Date.parse(q.t); if (isFinite(t)) pts.push([t, q.lat, q.lon]) } pts.push([Date.parse(lt.updatedAt) || Date.now(), lt.lat, lt.lon]) }
  pts.sort((a, b) => a[0] - b[0]);
  const out = []; for (const p of pts) { const l = out[out.length - 1]; if (!l || km([l[1], l[2]], [p[1], p[2]]) > .3) out.push(p) }
  return out
}
function drawRoute(ts) {
  if (!route || route.pts.length < 2) return;
  const col = TM(route.type).c, P = route.pts.map(p => map.latLngToContainerPoint([p[1], p[2]]));
  cx.setLineDash([2, 5]); cx.beginPath(); cx.moveTo(P[0].x, P[0].y); for (const q of P) cx.lineTo(q.x, q.y); cx.strokeStyle = col; cx.globalAlpha = .5; cx.lineWidth = 1.5; cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
  cx.beginPath(); cx.arc(P[0].x, P[0].y, 4, 0, 7); cx.strokeStyle = col; cx.lineWidth = 2; cx.stroke();
  const PP = isLight() ? PALS.light : PALS.dark; cx.fillStyle = PP.sub; cx.font = "600 10px 'JetBrains Mono',monospace"; cx.fillText("start " + hm(route.pts[0][0]), P[0].x + 7, P[0].y - 6);
  if (!replay) return;
  const dur = replay.dur, p = Math.min(1, (ts - replay.start) / dur);
  if (ts - replay.start > dur + 1800) { replay = null; renderDetail(); return }
  // pozycja wzdłuż trasy proporcjonalnie do czasu lotu
  const t0 = route.pts[0][0], t1 = route.pts[route.pts.length - 1][0], tt = t0 + (t1 - t0) * p;
  let k = 1; while (k < route.pts.length - 1 && route.pts[k][0] < tt) k++;
  const a = route.pts[k - 1], b = route.pts[k], f = b[0] > a[0] ? Math.min(1, Math.max(0, (tt - a[0]) / (b[0] - a[0]))) : 1;
  const head = [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], H = map.latLngToContainerPoint(head);
  cx.beginPath(); cx.moveTo(P[0].x, P[0].y); for (let i = 1; i < k; i++) cx.lineTo(P[i].x, P[i].y); cx.lineTo(H.x, H.y);
  cx.strokeStyle = col; cx.lineWidth = 3.2; cx.shadowColor = col; cx.shadowBlur = 16; cx.lineCap = "round"; cx.lineJoin = "round"; cx.stroke(); cx.shadowBlur = 0;
  const ang = bearingOf([a[1], a[2]], [b[1], b[2]]) * R;
  cx.save(); cx.translate(H.x, H.y); cx.rotate(ang); cx.beginPath(); cx.moveTo(0, -11); cx.lineTo(7, 8); cx.lineTo(0, 4); cx.lineTo(-7, 8); cx.closePath();
  cx.fillStyle = col; cx.shadowColor = col; cx.shadowBlur = 20; cx.fill(); cx.restore(); cx.shadowBlur = 0;
  cx.beginPath(); cx.arc(H.x, H.y, 16 + 6 * Math.sin(ts / 120), 0, 7); cx.strokeStyle = col; cx.globalAlpha = .5; cx.lineWidth = 1.5; cx.stroke(); cx.globalAlpha = 1;
  const lbl = hm(tt); cx.font = "700 12px 'JetBrains Mono',monospace"; const w = cx.measureText(lbl).width + 12;
  cx.fillStyle = PP.labelBg; cx.fillRect(H.x + 16, H.y - 26, w, 20); cx.strokeStyle = col; cx.lineWidth = 1; cx.strokeRect(H.x + 16, H.y - 26, w, 20);
  cx.fillStyle = PP.text; cx.fillText(lbl, H.x + 22, H.y - 12)
}
function startReplay() {
  if (!route || route.pts.length < 2) return;
  replay = { start: performance.now(), dur: Math.min(14000, Math.max(5000, route.pts.length * 350)) };
  const b = L.latLngBounds(route.pts.map(p => [p[1], p[2]])); userMoved = true; map.flyToBounds(b, { padding: [60, 60], maxZoom: 8.5, duration: .8 });
  renderDetail()
}
let lastFast = 0;
function fastPositions(ts) {
  if (ts - lastFast < 60) return; lastFast = ts;
  if (mode === "hist") {
    const m = new Map(histThreatsAt(histTime).map(o => [o.id, o]));
    for (const o of view) { if (o.areaOnly) continue; const n = m.get(o.id); if (!n) continue; o.pos = [n.lat, n.lon]; if (n.heading != null) o.hdg = n.heading; const mk = markers.get(o.id); if (mk) mk.setLatLng(o.pos) }
  } else {
    const now = Date.now();
    for (const o of view) { if (o.areaOnly || !o.speed) continue; const t = live.threats.get(o.id); if (!t) continue; o.pos = deadReckon(t, now).pos; const mk = markers.get(o.id); if (mk) mk.setLatLng(o.pos) }
  }
}

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
    if (mode === "live" && !t.areaOnly) o.trail = mergedPts(t, now - 90 * 60000).slice(-60).map(p => ({ lat: p[1], lon: p[2] }));
    if (!t.areaOnly) { o.dist = inPL(o.pos) ? 0 : distPL(o.pos); o.inPL = o.dist === 0; o.toPL = o.advisory ? null : towardPL(o.pos, o.hdg) } else o.dist = null;
    view.push(o)
  }
  view.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  if (selected && !view.some(o => o.id === selected)) select(null, true);
  renderMarkers(); renderList(); renderStats(); renderDetail(); evalLevel();
}
const fmtAgo = iso => { const s = ((mode === "hist" ? histTime : Date.now()) - Date.parse(iso)) / 1000; if (!isFinite(s)) return ""; if (s < 60) return "przed chwilą"; if (s < 3600) return Math.round(s / 60) + " min temu"; return Math.round(s / 3600) + " godz. temu" };
const OBL_PL = { "Вінницька": "winnicki", "Волинська": "wołyński", "Дніпропетровська": "dniepropetrowski", "Донецька": "doniecki", "Житомирська": "żytomierski", "Закарпатська": "zakarpacki", "Запорізька": "zaporoski", "Івано-Франківська": "iwanofrankiwski", "Київська": "kijowski", "Кіровоградська": "kirowohradzki", "Луганська": "ługański", "Львівська": "lwowski", "Миколаївська": "mikołajowski", "Одеська": "odeski", "Полтавська": "połtawski", "Рівненська": "rówieński", "Сумська": "sumski", "Тернопільська": "tarnopolski", "Харківська": "charkowski", "Херсонська": "chersoński", "Хмельницька": "chmielnicki", "Черкаська": "czerkaski", "Чернівецька": "czerniowiecki", "Чернігівська": "czernihowski" };
const CITY_PL = { "Київ": "Kijów", "м. Київ": "Kijów", "Харків": "Charków", "Одеса": "Odessa", "Львів": "Lwów", "Дніпро": "Dniepr", "Запоріжжя": "Zaporoże", "Миколаїв": "Mikołajów", "Херсон": "Chersoń", "Чернігів": "Czernihów", "Суми": "Sumy", "Полтава": "Połtawa", "Житомир": "Żytomierz", "Рівне": "Równe", "Луцьк": "Łuck", "Тернопіль": "Tarnopol", "Хмельницький": "Chmielnicki", "Вінниця": "Winnica", "Черкаси": "Czerkasy", "Кропивницький": "Kropywnycki", "Чернівці": "Czerniowce", "Ужгород": "Użhorod", "Івано-Франківськ": "Iwano-Frankiwsk", "Ковель": "Kowel", "Біла Церква": "Biała Cerkiew", "Кременчук": "Krzemieńczuk", "Кривий Ріг": "Krzywy Róg", "Автономна Республіка Крим": "Krym", "Севастополь": "Sewastopol" };
const TL = { а: "a", б: "b", в: "w", г: "h", ґ: "g", д: "d", е: "e", є: "je", ж: "ż", з: "z", и: "y", і: "i", ї: "ji", й: "j", к: "k", л: "ł", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "ch", ц: "c", ч: "cz", ш: "sz", щ: "szcz", ю: "ju", я: "ja", ы: "y", э: "e", ё: "jo", ъ: "", "'": "", "’": "" };
const SOFT = { н: "ń", с: "ś", ц: "ć", з: "ź", л: "l", т: "t", д: "d" };
function translit(w) {
  if (!w || !/[а-яіїєґё]/i.test(w)) return w || "";
  if (CITY_PL[w]) return CITY_PL[w];
  let out = "";
  for (let i = 0; i < w.length; i++) {
    const ch = w[i], lo = ch.toLowerCase(), up = ch !== lo, nx = (w[i + 1] || "").toLowerCase(), pv = (w[i - 1] || "").toLowerCase();
    let r;
    if (lo === "ь") continue;
    if (nx === "ь" && SOFT[lo]) r = SOFT[lo];
    else if (lo === "л" && /[іїєюя]/.test(nx)) r = "l";
    else if (/[єюя]/.test(lo) && pv && /[бвгґджзклмнпрстфхцчшщ]/.test(pv)) r = { є: "ie", ю: "iu", я: "ia" }[lo];
    else r = TL[lo] ?? ch;
    out += up && r ? r[0].toUpperCase() + r.slice(1) : r;
  }
  return out
}
function plRegion(r) { if (!r) return ""; const m = r.match(/^(.+?) область$/); if (m) return OBL_PL[m[1]] ? "obw. " + OBL_PL[m[1]] : translit(r); return CITY_PL[r] || translit(r) }
const plLoc = o => o.locality && o.locality !== o.region ? translit(o.locality) : "";
const place = o => [plLoc(o), plRegion(o.region)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || translit(o.locality || "");

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
  selected = id; replay = null;
  route = null; if (id) { const o = view.find(x => x.id === id); if (o && !o.areaOnly) { loadHistory(); route = { id, type: o.type, pts: routeFor(id) } } }
  if (!silent) {
    const o = view.find(x => x.id === id);
    if (o) { userMoved = true; if (o.areaOnly) { const ob = OBL_BY_NAME.get(o.region); if (ob) map.flyToBounds(L.polygon(ob.g).getBounds(), { duration: .8 }) } else { const z = Math.max(map.getZoom(), 7.25); const c = mobile() ? map.unproject(map.project(o.pos, z).add([0, map.getSize().y * .24]), z) : o.pos; map.flyTo(c, z, { duration: .8 }) } }
    if (mobile() && id) { setSheet("half"); $("side-scroll").scrollTo({ top: 0, behavior: "smooth" }) }
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
      <span class="s">${esc(place(o))}${o.updatedAt ? " · " + fmtAgo(o.updatedAt) : ""}</span></button>`
  });
  for (const o of area.slice(0, 8)) { const m = TM(o.type); rows.push(`<button class="it" data-id="${esc(o.id)}" style="--c:${m.c}"><span class="ic">${icon(o.type)}</span><span class="t">${m.n}${o.count > 1 ? " ×" + o.count : ""}<span class="tag area">tylko obwód</span></span><span class="d">—</span><span class="s">${esc(plRegion(o.region))}${o.updatedAt ? " · " + fmtAgo(o.updatedAt) : ""}</span></button>`) }
  $("list").innerHTML = rows.join("") || '<span class="empty">Brak aktywnych zagrożeń w powietrzu.</span>';
}
$("list").addEventListener("click", e => { const b = e.target.closest(".it"); if (b) select(b.dataset.id) });
function compass(h, c) {
  return `<svg class="compass" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" fill="rgba(0,0,0,.3)" stroke="rgba(120,170,255,.3)"/>${[0, 90, 180, 270].map((a, i) => `<text x="${28 + Math.sin(a * R) * 19}" y="${28 - Math.cos(a * R) * 19 + 3}" fill="#5f6f8c" font-size="8" font-family="JetBrains Mono" text-anchor="middle">${"NESW"[i]}</text>`).join("")}${h == null ? "" : `<path d="M28 9 32 30 28 27 24 30Z" fill="${c}" transform="rotate(${h} 28 28)"/>`}<circle cx="28" cy="28" r="2.5" fill="#eaf1fb"/></svg>`
}
function renderDetail() {
  const o = view.find(x => x.id === selected); $("detail-sec").hidden = !o; if (!o) return;
  if (route && route.id === o.id && !replay && hist.snaps.length) route.pts = routeFor(o.id);
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
    ${route && route.pts.length > 1 ? `<div class="row"><button class="btn pri" id="d-replay" ${replay ? "disabled" : ""}>${replay ? "Odtwarzanie lotu…" : "▶ Odtwórz cały lot"}</button><span class="note">${route.pts.length} punktów, od ${hm(route.pts[0][0])}</span></div>` : '<p class="note">Trasa pojawi się, gdy zbierze się więcej pozycji.</p>'}
    <p class="src">${mode === "hist" ? "Stan z godz. " + hm(histTime) : o.updatedAt ? "Aktualizacja: " + fmtAgo(o.updatedAt) : ""}</p>`;
  $("d-close").onclick = () => select(null);
  const rb = $("d-replay"); if (rb) rb.onclick = startReplay;
}
function setStat(id, v) { const el = $(id); el.textContent = v; el.parentElement.classList.toggle("zero", v === 0 || v === "—") }
function renderStats() {
  const c = t => view.filter(o => o.type === t && !o.advisory).reduce((a, o) => a + (o.count > 1 ? o.count : 1), 0);
  setStat("s-uav", c("uav") + c("recon")); setStat("s-mis", c("missile")); setStat("s-bal", c("ballistic")); setStat("s-kab", c("kab"));
  const near = view.find(o => o.dist != null && !o.advisory); setStat("s-near", near ? (near.inPL ? "NAD RP" : Math.round(near.dist) + " km") : "—");
  const n = view.length;
  $("peek-l").innerHTML = near ? `Najbliżej RP: <b>${near.inPL ? "nad Polską" : Math.round(near.dist) + " km"}</b> · ${esc(TM(near.type).s)}` : (live.haveData || mode === "hist") ? "Brak obiektów z pozycją" : "Czekam na dane…";
  $("peek-r").textContent = n ? n + " w powietrzu" : ""
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
  if (mode === "live" && live.alerts) {
    if (prevBorder) { for (const b of n.border) if (!prevBorder.includes(b)) addEvent(1, "Alarm lotniczy przy granicy RP", b, "al:" + b + ":" + Math.floor(Date.now() / 60000)); for (const b of prevBorder) if (!n.border.includes(b)) addEvent(0, "Odwołano alarm przy granicy", b, "alx:" + b + ":" + Math.floor(Date.now() / 60000)) }
    else if (n.border.length) addEvent(1, "Trwa alarm lotniczy przy granicy RP", n.border.join(", "), "alnow:" + n.border.join("|") + ":" + Math.floor(Date.now() / 1800e3));
    prevBorder = n.border.slice()
  }
  curBorder = n.border; evalLevel();
}
let curBorder = [], prevBorder = null;
const refreshAlerts = () => renderAlerts(mode === "hist" ? normCompact(histAlertsAt(histTime)) : normLiveAlerts(live.alerts));

/* ---------- wiadomości ---------- */
function renderTicker() {
  if (!messages.length) return;
  const tx = m => m.pl || m.text;
  const items = messages.slice(0, 25).map(m => `<span><time>${hm(m.date)}</time><b>${esc(m.channel)}</b>${esc(String(tx(m)).replace(/\s+/g, " ").slice(0, 180))}</span>`).join("");
  $("msgs").innerHTML = messages.slice(0, 12).map(m => `<div><span>${hm(m.date)} · <b>${esc(m.channel)}</b>${m.pl ? " · przetłumaczone" : ""}</span>${esc(String(tx(m)).slice(0, 400))}${m.pl && m.pl !== m.text ? `<details class="orig"><summary>oryginał ▸</summary>${esc(String(m.text).slice(0, 400))}</details>` : ""}</div>`).join("");
  const rail = $("rail"); rail.innerHTML = items + items; rail.style.setProperty("--dur", Math.max(40, messages.slice(0, 25).reduce((a, m) => a + Math.min(180, String(m.text).length), 0) / 9) + "s")
}

/* ---------- komunikaty ---------- */
const BOOT = Date.now();
const events = store.get("events", []).filter(e => e.t > Date.now() - 24 * 3600e3);
const evKeys = new Set(events.map(e => e.k));
let unread = 0;
function addEvent(level, title, body, key, ll) {
  if (key && evKeys.has(key)) return; if (key) evKeys.add(key);
  const e = { t: Date.now(), l: level, title, body, k: key, ll }; events.unshift(e); if (events.length > 80) events.length = 80;
  store.set("events", events); unread++; renderEvents(true);
  if (level >= 1 && mode === "live" && (Date.now() - BOOT > 20000 || level >= 2)) showBanner(e)
}
function renderEvents(fresh) {
  $("ev-n").textContent = events.length ? events.length + " z 24 h" : "—";
  const b = $("ev-badge"); b.hidden = !unread; b.textContent = unread;
  if (!events.length) return;
  $("events").innerHTML = events.slice(0, 40).map((e, i) => `<button class="ev l${e.l}${fresh && i < unread ? " new" : ""}" data-i="${i}"><i></i><b>${esc(e.title)}</b><span><time>${hm(e.t)}</time>${esc(e.body || "")}</span></button>`).join("")
}
$("events").addEventListener("click", ev => { const b = ev.target.closest(".ev"); if (!b) return; const e = events[+b.dataset.i]; unread = 0; renderEvents(); if (e && e.ll) { userMoved = true; map.flyTo(e.ll, Math.max(map.getZoom(), 7), { duration: .8 }) } });
let bannerT;
function showBanner(e) {
  const bn = $("banner"); bn.className = "hud banner glass l" + e.l; $("banner-i").textContent = e.l >= 2 ? "!" : "⚠";
  $("banner-t").textContent = e.title; $("banner-b").textContent = e.body || ""; bn.hidden = false; bn.style.animation = "none"; bn.offsetHeight; bn.style.animation = "";
  bn.onclick = ev => { if (ev.target.id === "banner-x") { bn.hidden = true; return } bn.hidden = true; unread = 0; renderEvents(); if (e.ll) { userMoved = true; map.flyTo(e.ll, Math.max(map.getZoom(), 7), { duration: .8 }) } };
  clearTimeout(bannerT); if (e.l < 2) bannerT = setTimeout(() => bn.hidden = true, 9000)
}
renderEvents();

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
  let l = 0; if (curBorder.length || close || toward || rcbActive) l = 1; if (inside || (close && close.toPL)) l = 2;
  $("level").dataset.l = l; $("level-t").textContent = ["niskie", "podwyższone", "wysokie"][l];
  if (mode !== "live" || !live.haveData) return;
  for (const o of act) {
    const nm = TM(o.type).n + (o.count > 1 ? " ×" + o.count : "");
    if (o.inPL) addEvent(2, `${nm} nad Polską`, `Okolice m. ${nearestPLCity(o.pos)}. Słuchaj komunikatów RCB.`, "in:" + o.id, o.pos);
    else if (o.dist < thr) addEvent(o.toPL ? 2 : 1, `${nm} ${Math.round(o.dist)} km od granicy`, `${place(o)}${o.toPL ? ". Kurs w stronę Polski" : ""}.`, "near" + thr + ":" + o.id, o.pos);
    else if (o.toPL && o.dist < thr * 2.5) addEvent(1, `${nm} leci w stronę Polski`, `${place(o)}, ${Math.round(o.dist)} km od granicy.`, "tow:" + o.id, o.pos);
    else if (o.dist < 350) addEvent(0, `Nowy obiekt: ${nm}`, `${place(o)}, ${Math.round(o.dist)} km od granicy RP.`, "new:" + o.id, o.pos);
  }
  const drones = act.filter(o => o.type === "uav").reduce((a, o) => a + (o.count > 1 ? o.count : 1), 0);
  if (drones >= 25) addEvent(1, `Zmasowany atak dronów: ${drones} w powietrzu`, "Obserwuj sytuację przy granicy i komunikaty RCB.", "mass:" + Math.floor(Date.now() / 3 / 3600e3));
  for (const o of act) {
    const key = o.id + (o.inPL ? ":in" : ":near"); if (!(o.inPL || o.dist < thr) || warned.has(key)) continue; warned.add(key);
    notify(o.inPL ? `🚨 ${TM(o.type).n} nad Polską` : `⚠️ ${TM(o.type).n} ${Math.round(o.dist)} km od granicy`, o.inPL ? `Okolice m. ${nearestPLCity(o.pos)}.` : `${place(o)}${o.toPL ? ". Kurs w stronę Polski" : ""}.`, (o.inPL ? "in-" : "near-") + o.id)
  }
  if (lastLevel !== -1 && l > lastLevel) beep(l === 2 ? 5 : 2); lastLevel = l
}

/* ---------- dane na żywo ---------- */
function setLive(state, text) { $("live").className = "live " + state; $("livetxt").textContent = text }
function stamp(src) { $("src").textContent = `Źródło: ${src} · ${new Date().toLocaleTimeString("pl-PL")}` }
function applySnapshot(list) { live.threats.clear(); for (const t of list || []) { live.threats.set(t.id, t); recordObs(t) } const first = !live.haveData; live.haveData = true; if (first) setTimeout(saveLocal, 3000); if (mode === "live") recompute() }
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
      else if (env.type === "upsert" && env.data && env.data.id) { live.threats.set(env.data.id, env.data); recordObs(env.data); if (mode === "live") recompute() }
      else if (env.type === "remove" && env.data) { live.threats.delete(env.data.id); if (mode === "live") recompute() }
      else if (env.type === "alerts" && env.data) { live.alerts = env.data; if (mode === "live") refreshAlerts() }
      stamp("NEPTUN, WebSocket na żywo")
    };
    ws.onerror = fail;
    ws.onclose = () => { if (done && source === "ws") { setLive("err", "Rozłączono, ponawiam…"); addEvent(0, "Utracono połączenie z NEPTUN", "Ponawiam połączenie automatycznie.", "lost:" + Math.floor(Date.now() / 60000)); source = "none"; setTimeout(connect, Math.min(30000, 3000 * ++wsRetry)) } else fail() }
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
async function pollMsgs() {
  // najpierw z serwera (z tłumaczeniem na polski), potem prosto z NEPTUN
  if (WORKER) try { const j = await fetchJSON(WORKER + "/api/messages"); if (j.messages && j.messages.length && Date.now() - j.t < 10 * 60000) { messages = j.messages; renderTicker(); return } } catch (e) { }
  try { const j = await fetchJSON(API + "/api/v1/messages"); messages = j.messages || []; renderTicker() } catch (e) { }
}

/* ---------- alerty RCB ---------- */
let rcbState = { items: [] }, rcbActive = false;
function renderRcb() {
  const items = rcbState.items || [];
  if (!WORKER) { $("rcb").innerHTML = '<span class="empty">Alerty RCB są dostępne, gdy działa serwer aplikacji.</span>'; return }
  if (!items.length) { $("rcb").innerHTML = '<span class="empty">Brak alertów RCB z ostatnich dni.</span>'; $("rcb-n").textContent = "—"; return }
  const today = new Date().toISOString().slice(0, 10);
  const it = items[0], ups = it.updates || [], cur = ups.find(u => u.time) || ups[0] || {};
  const lv = it.date === today ? (cur.level ?? 1) : 0;
  rcbActive = it.date === today && lv === 2;
  $("rcb-n").textContent = it.date === today ? "dziś" : it.date.split("-").reverse().join(".");
  const upd = u => `<div><time>${u.time ? "godz. " + u.time : "pierwszy komunikat"}</time><q>${esc(u.text || "")}</q>${u.voiv && u.voiv.length ? `<span>Woj.: ${esc(u.voiv.join(", "))}</span>` : ""}</div>`;
  $("rcb").innerHTML = `<div class="rcb l${lv}"><div class="rt"><b>${esc(it.title)}</b><time>${cur.time ? "godz. " + cur.time : esc(it.date)}</time></div>
    ${cur.text ? `<q>${esc(cur.text)}</q>` : ""}
    ${cur.voiv && cur.voiv.length ? `<div class="vo">${cur.voiv.map(v => `<span>woj. ${esc(v)}</span>`).join("")}</div>` : ""}
    ${ups.length > 1 ? `<details><summary>Wcześniejsze komunikaty (${ups.length - 1})</summary>${ups.filter(u => u !== cur).map(upd).join("")}</details>` : ""}
    <a href="${esc(it.url)}" target="_blank" rel="noopener">Pełna treść na gov.pl ↗</a></div>
    ${items.slice(1, 4).map(o => `<a class="nw" style="border-left-color:var(--dim)" href="${esc(o.url)}" target="_blank" rel="noopener"><b>${esc(o.title)}</b><span>${esc(o.date.split("-").reverse().join("."))}</span></a>`).join("")}`;
  if (it.date === today && cur.text) addEvent(lv, "Alert RCB" + (cur.time ? " (" + cur.time + ")" : ""), cur.text + (cur.voiv && cur.voiv.length ? " Woj.: " + cur.voiv.join(", ") + "." : ""), "rcb:" + it.id + ":" + (cur.time || "0"));
  evalLevel()
}
async function pollRcb() { if (!WORKER) { renderRcb(); return } try { rcbState = await fetchJSON(WORKER + "/api/rcb"); renderRcb() } catch (e) { } }

/* ---------- zdarzenia w Polsce (media) ---------- */
let newsState = { items: [] }; const newsLayer = L.layerGroup().addTo(map);
/* ikony zdarzeń: Tabler Icons (MIT, tabler.io/icons) */
const INC = {
  missile: { n: "Rakieta / pocisk", c: "#e8213a", fill: false, d: '<path d="M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3"/><path d="M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3"/><path d="M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>' },
  drone: { n: "Dron", c: "#f26b00", fill: false, d: '<path d="M10 10h4v4h-4z"/><path d="M10 10l-3.5 -3.5"/><path d="M9.96 6a3.5 3.5 0 1 0 -3.96 3.96"/><path d="M14 10l3.5 -3.5"/><path d="M18 9.96a3.5 3.5 0 1 0 -3.96 -3.96"/><path d="M14 14l3.5 3.5"/><path d="M14.04 18a3.5 3.5 0 1 0 3.96 -3.96"/><path d="M10 14l-3.5 3.5"/><path d="M6 14.04a3.5 3.5 0 1 0 3.96 3.96"/>' },
  explosion: { n: "Wybuch", c: "#d99200", fill: true, d: '<path d="M7.514 3.836c.151 -.909 1.346 -1.147 1.834 -.366c2.294 3.67 4.275 4.048 5.758 1.083c.471 -.944 1.894 -.608 1.894 .447c0 2.448 1.552 4 4 4c.89 0 1.337 1.077 .707 1.707c-1.61 1.61 -1.61 2.975 0 4.581c.63 .63 .185 1.707 -.706 1.708c-2.448 .003 -3.001 .556 -3.001 3.004c0 .961 -1.223 1.369 -1.8 .6c-2.325 -3.1 -5.494 -2.856 -7.368 -.045c-.503 .754 -1.67 .504 -1.818 -.39c-.365 -2.188 -1.04 -2.656 -4.178 -3.179a1 1 0 0 1 -.543 -1.693c1.618 -1.618 1.618 -3.027 -.053 -4.981a1 1 0 0 1 .523 -1.66c2.39 -.613 3.934 -2.19 4.411 -4.523z"/>' },
  debris: { n: "Szczątki / upadek obiektu", c: "#7b4fd6", fill: true, d: '<path d="M21.874 3.486l-4.174 7.514h3.3c.846 0 1.293 .973 .791 1.612l-.074 .085l-6.9 7.095a7.5 7.5 0 1 1 -10.21 -10.974l7.746 -6.58c.722 -.614 1.814 .028 1.628 .958l-.577 2.879l7.11 -3.95c.88 -.488 1.849 .481 1.36 1.36m-12.374 7.515a3.5 3.5 0 0 0 -3.495 3.308l-.005 .192a3.5 3.5 0 1 0 3.5 -3.5"/>' },
  airspace: { n: "Naruszenie przestrzeni", c: "#5f6f8c", fill: true, d: '<path d="M12 1.67c.955 0 1.845 .467 2.39 1.247l.105 .16l8.114 13.548a2.914 2.914 0 0 1 -2.307 4.363l-.195 .008h-16.225a2.914 2.914 0 0 1 -2.582 -4.2l.099 -.185l8.11 -13.538a2.914 2.914 0 0 1 2.491 -1.403zm.01 13.33l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -7a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z"/>' }
};
const SEV = ["missile", "drone", "explosion", "debris", "airspace"];
const incIcon = (k, color) => { const m = INC[k] || INC.airspace; return `<svg viewBox="0 0 24 24" fill="${m.fill ? color || "currentColor" : "none"}" stroke="${m.fill ? "none" : color || "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${m.d}</svg>` };
function pinHTML(kind, count, label, fresh, approx) {
  const m = INC[kind] || INC.debris;
  return `<div class="ipin${fresh ? " fresh" : ""}${approx ? " approx" : ""}" style="--c:${m.c}"><svg class="drop" viewBox="0 0 40 52"><path d="M20 50C20 50 4 31.5 4 20a16 16 0 1 1 32 0c0 11.5-16 30-16 30z"/><circle cx="20" cy="20" r="12.5"/></svg><span class="glyph">${incIcon(kind, "#fff")}</span>${count > 1 ? `<span class="n">${count}</span>` : ""}<em>${esc(label)}</em></div>`
}
const dt = t => new Date(t).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function renderNews() {
  const items = (newsState.items || []).filter(n => n.t > Date.now() - 72 * 3600e3);
  const hits = items.filter(n => n.impact);
  $("news-n").textContent = items.length ? `${hits.length} upadków/wybuchów · ${items.length} doniesień` : "—";
  if (!WORKER) { $("news").innerHTML = '<span class="empty">Doniesienia są dostępne, gdy działa serwer aplikacji.</span>'; return }
  $("news").innerHTML = items.length ? items.slice(0, 20).map(n => { const k = n.kind || "airspace", m = INC[k] || INC.airspace;
    return `<a class="nw ${n.impact ? "hit" : ""}" style="--c:${m.c}" href="${esc(n.link)}" target="_blank" rel="noopener"><span class="nk">${incIcon(k)}</span><b>${esc(n.title)}</b><span>${dt(n.t)} · ${esc(n.src)}${n.place ? ` · <span class="pin">📍 ${esc(n.place.name)}${n.place.approx ? " (przybliżone)" : ""}</span>` : ""}</span></a>` }).join("") : '<span class="empty">Brak doniesień o zdarzeniach w Polsce z ostatnich 72 godzin.</span>';
  // znaczniki: tylko upadki/wybuchy z ustalonym miejscem, zgrupowane po miejscu
  newsLayer.clearLayers();
  const groups = new Map();
  for (const n of hits) { if (!n.place || n.t < Date.now() - 48 * 3600e3) continue; const k = n.place.name; const g = groups.get(k) || { place: n.place, items: [] }; g.items.push(n); if (n.place.how === "village") g.place = n.place; groups.set(k, g) }
  for (const [k, g] of groups) {
    const kind = SEV.find(s => g.items.some(x => x.kind === s)) || "debris", last = Math.max(...g.items.map(x => x.t));
    const pop = `<div class="ipop"><b>${esc(k)}${g.place.approx ? " (miejsce przybliżone)" : ""}</b><span>${INC[kind].n} · doniesienia mediów, niepotwierdzone</span>${g.items.slice(0, 6).map(x => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<small>${esc(x.src)} · ${dt(x.t)}</small></a>`).join("")}</div>`;
    L.marker([g.place.lat, g.place.lon], { zIndexOffset: 1600, keyboard: true, title: k, icon: L.divIcon({ className: "", html: pinHTML(kind, g.items.length, `${k} · ${hm(last)}`, last > Date.now() - 6 * 3600e3, g.place.approx), iconSize: [40, 52], iconAnchor: [20, 50] }) })
      .bindPopup(pop, { className: "tip-pop", maxWidth: 300, offset: [0, -40] }).addTo(newsLayer);
  }
  for (const n of hits) if (n.t > Date.now() - 6 * 3600e3) addEvent(n.t > Date.now() - 30 * 60000 ? 1 : 0, (INC[n.kind] || INC.debris).n + ": " + n.title, n.src + (n.place ? " · " + n.place.name : "") + ". Informacja mediów, niepotwierdzona.", "news:" + n.id, n.place ? [n.place.lat, n.place.lon] : null);
}
async function pollNews() { if (!WORKER) { renderNews(); return } try { newsState = await fetchJSON(WORKER + "/api/news"); renderNews() } catch (e) { } }

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
  if (hist.from !== "worker") useLocal(); computeBars(); drawTrack(); saveLocal();
}, 20000);
function useLocal() { hist.snaps = local.snaps; hist.alerts = local.alerts; hist.from = "local"; buildHistIndex() }
function saveLocal() {
  const cut = Date.now() - 6 * 3600e3; while (local.snaps.length && local.snaps[0][0] < cut) local.snaps.shift();
  for (let h = 6; h >= 1; h -= 2) { try { const c = Date.now() - h * 3600e3; localStorage.setItem("sn:hist", JSON.stringify({ snaps: local.snaps.filter(x => x[0] >= c), alerts: local.alerts.slice(-60) })); return } catch (e) { } }
}
(function loadLocal() { try { const j = JSON.parse(localStorage.getItem("sn:hist") || "null"); if (j && Array.isArray(j.snaps)) { local.snaps = j.snaps.filter(x => x[0] > Date.now() - 24 * 3600e3); local.alerts = j.alerts || [] } } catch (e) { } })();
async function loadHistory(force) {
  if (!WORKER) { useLocal(); drawTrack(); return }
  if (!force && Date.now() - hist.loadedAt < 120000 && hist.from === "worker") return;
  try {
    const step = hist.hours > 12 ? 3 : hist.hours > 6 ? 2 : 1;
    const j = await fetchJSON(`${WORKER}/api/history?hours=${hist.hours}&step=${step}`, 30000);
    if (j.snaps && j.snaps.length > 2) { hist.snaps = j.snaps; hist.alerts = j.alerts || []; hist.from = "worker"; hist.loadedAt = Date.now(); buildHistIndex() } else useLocal();
  } catch (e) { useLocal() }
  computeBars(); drawTrack();
}
function idxAt(arr, t) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= t) { r = m; lo = m + 1 } else hi = m - 1 } return r }
const bearingOf = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * R), b[0] - a[0]) / R + 360) % 360;
let hcache = { key: "", base: null };
function histBase(i) {
  const key = i + ":" + hist.snaps.length + ":" + hist.snaps[i][0];
  if (hcache.key === key) return hcache.base;
  const [st, rows] = hist.snaps[i], nx = hist.snaps[i + 1];
  const back = []; for (let j = i - 1; j >= 0 && st - hist.snaps[j][0] <= 45 * 60000; j--) back.push(hist.snaps[j]);
  const list = rows.map(r => {
    const [id, type, lat, lon, hdg, count, f, loc] = r;
    const trail = []; let prev = null;
    for (let k = back.length - 1; k >= 0; k--) { const q = back[k][1].find(x => x[0] === id); if (q && !(q[6] & 1)) { const l = trail[trail.length - 1]; if (!l || l.lat !== q[2] || l.lon !== q[3]) { trail.push({ lat: q[2], lon: q[3] }); prev = [back[k][0], q[2], q[3]] } } }
    let heading = hdg, velocity = null;
    if (prev && !(f & 1)) { const d = km([prev[1], prev[2]], [lat, lon]), h = (st - prev[0]) / 3600e3; if (d > 1 && h > 0) { const b = bearingOf([prev[1], prev[2]], [lat, lon]); if (heading == null) heading = b; const v = d / h; if (v < 1200) velocity = { speedKmh: v, bearingDeg: heading } } }
    return { id, type, lat, lon, heading, velocity, count, areaOnly: !!(f & 1), advisory: !!(f & 2), status: f & 4 ? "stale" : "active", locality: loc, region: (f & 1) ? loc : "", trail }
  });
  hcache = { key, base: { list, st, nt: nx ? nx[0] : 0, next: nx ? new Map(nx[1].map(r => [r[0], r])) : null } };
  return hcache.base
}
function histThreatsAt(t) {
  const i = idxAt(hist.snaps, t); if (i < 0) return [];
  const b = histBase(i);
  const f = b.nt && b.nt - b.st <= 6 * 60000 ? Math.min(1, Math.max(0, (t - b.st) / (b.nt - b.st))) : 0;
  if (!f) return b.list;
  return b.list.map(o => {
    const q = b.next.get(o.id); if (!q || o.areaOnly || (q[6] & 1)) return o;
    const moved = km([o.lat, o.lon], [q[2], q[3]]) > .5;
    return { ...o, lat: o.lat + (q[2] - o.lat) * f, lon: o.lon + (q[3] - o.lon) * f, heading: moved ? bearingOf([o.lat, o.lon], [q[2], q[3]]) : o.heading }
  })
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
  tcx.fillStyle = isLight() ? "rgba(10,30,60,.05)" : "rgba(255,255,255,.04)"; tcx.fillRect(0, 4, W, base - 4);
  const max = Math.max(4, ...bars.map(x => x.v)), bw = W / Math.max(1, bars.length);
  bars.forEach((x, i) => {
    if (x.al) { tcx.fillStyle = "rgba(255,59,78,.85)"; tcx.fillRect(i * bw, 4, bw, 2.5) }
    if (!x.v) return; const h = Math.max(2, (base - 10) * x.v / max);
    tcx.fillStyle = x.near ? "rgba(255,59,78,.85)" : mode === "hist" ? "rgba(255,190,80,.55)" : (isLight() ? "rgba(3,120,150,.55)" : "rgba(56,225,255,.5)"); tcx.fillRect(i * bw + .5, base - h, Math.max(1, bw - 1), h)
  });
  if (!hist.snaps.length) { tcx.fillStyle = isLight() ? "#6b7a92" : "#5f6f8c"; tcx.font = "500 11px 'IBM Plex Sans',sans-serif"; tcx.fillText(WORKER ? "Wczytywanie historii…" : "Historia zapisuje się od otwarcia strony (co minutę)", 8, base / 2 + 6) }
  tcx.fillStyle = isLight() ? "#6b7a92" : "#5f6f8c"; tcx.font = "500 9px 'JetBrains Mono',monospace";
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
let playing = false, lastPT = 0, lastFull = 0;
const playIcon = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M4 2.5v11l9-5.5z"/></svg>', pauseIcon = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z"/></svg>';
function stopPlay() { playing = false; $("t-play").innerHTML = playIcon; $("t-play").setAttribute("aria-label", "Odtwórz historię") }
function playStep(ts) {
  if (!playing) return;
  const dt = lastPT ? Math.min(100, ts - lastPT) : 0; lastPT = ts;
  const [a2, b2] = trange(); histTime += dt * +$("t-speed").value;
  if (histTime >= b2 - 30000) { goLive(); return }
  $("t-range").value = Math.round((histTime - a2) / (b2 - a2) * 1000);
  if (ts - lastFull > 350) { lastFull = ts; recompute(); refreshAlerts(); setLabel(); drawTrack() }
  requestAnimationFrame(playStep)
}
$("t-play").onclick = async () => {
  if (playing) { stopPlay(); return }
  await loadHistory();
  if (!hist.snaps.length) { enterHist(0); return }
  const [a, b] = trange(); if (mode === "live" || histTime >= b - 60000) enterHist(Math.max(a, hist.snaps[0][0]));
  $("t-play").innerHTML = pauseIcon; $("t-play").setAttribute("aria-label", "Zatrzymaj odtwarzanie");
  playing = true; lastPT = 0; requestAnimationFrame(playStep)
};
new ResizeObserver(() => drawTrack()).observe($("t-canvas"));
setInterval(() => { computeBars(); drawTrack(); if (mode === "hist") setLabel() }, 30000);
let toastT; function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4000) }

/* ---------- powiadomienia w tle (Web Push) ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const PREFS = ["inPL", "near", "toward", "border", "rcb", "news"];
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
function pushError(e) {
  const msg = String(e && (e.message || e) || "");
  if (e && e.name === "NotAllowedError") return "Przeglądarka zablokowała powiadomienia dla tej strony. Zezwól na nie w ustawieniach strony (ikona kłódki obok adresu).";
  if (/push service|AbortError|registration failed/i.test(msg) || (e && e.name === "AbortError")) {
    if (navigator.brave) return "Brave domyślnie wyłącza usługę powiadomień. Wejdź w brave://settings/privacy, włącz „Use Google services for push messaging”, uruchom przeglądarkę ponownie i spróbuj jeszcze raz. Możesz też użyć Chrome.";
    return "Przeglądarka nie połączyła się ze swoją usługą powiadomień (błąd po stronie przeglądarki, nie serwera). Najczęstsze przyczyny: przeglądarka Brave lub Opera, telefon bez usług Google (np. Huawei), tryb incognito albo oszczędzanie danych/VPN blokujące usługi Google. Spróbuj w zwykłym oknie Chrome lub Firefoksa.";
  }
  return "Nie udało się włączyć powiadomień: " + msg
}
async function subscribeOnce(key) {
  try { return await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }) }
  catch (e) {
    // stara subskrypcja z innym kluczem albo chwilowy błąd usługi: wyczyść i spróbuj raz jeszcze
    const old = await swReg.pushManager.getSubscription().catch(() => null); if (old) await old.unsubscribe().catch(() => { });
    await new Promise(r => setTimeout(r, 1500));
    return swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) })
  }
}
$("push-on").onclick = async () => {
  const b = $("push-on"); b.disabled = true; pushStatus("Włączanie…");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { pushStatus("Nie zezwolono na powiadomienia. Zmień to w ustawieniach przeglądarki dla tej strony.", "bad"); return }
    swReg = swReg || await navigator.serviceWorker.ready;
    const { key } = await fetchJSON(WORKER + "/api/vapid");
    const sub = await subscribeOnce(key);
    await post("/api/subscribe", { subscription: sub.toJSON(), prefs: prefs() });
    await showPushState(); toast("Powiadomienia w tle włączone.");
  } catch (e) { pushStatus(pushError(e), "bad") } finally { b.disabled = false }
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

/* ---------- stan serwera ---------- */
async function checkServer() {
  if (!WORKER) { $("srv").textContent = "Serwer: brak (historia tylko w tej przeglądarce)"; return }
  try {
    const j = await fetchJSON(WORKER + "/api/status");
    const age = j.lastSnapshot ? Math.round((Date.now() - j.lastSnapshot) / 60000) : null;
    if (j.ok === false || (j.error && j.lastRun)) $("srv").textContent = `Serwer: błąd pobierania danych (${j.error}). Historia się nie zapisuje.`;
    else if (age == null) $("srv").textContent = "Serwer: historia jeszcze pusta. Pierwszy zapis w ciągu minuty od wdrożenia.";
    else if (age > 5) $("srv").textContent = `Serwer: ostatni zapis historii ${age} min temu. Zadanie co minutę nie działa.`;
    else $("srv").textContent = `Serwer: działa, historia z ${j.snapshots || "?"} min (ostatni zapis ${age < 1 ? "przed chwilą" : age + " min temu"}).`;
  } catch (e) { $("srv").textContent = "Serwer: brak odpowiedzi (" + (e.message || e) + ")" }
}

/* ---------- motyw ---------- */
const SUN = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"/></g></svg>',
  MOON = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M10.8 1.6a6.6 6.6 0 1 0 3.6 10.7A5.6 5.6 0 0 1 10.8 1.6z"/></svg>',
  AUTO = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path fill="currentColor" d="M8 1.8a6.2 6.2 0 0 1 0 12.4z"/></svg>';
function setTheme(t) {
  document.documentElement.dataset.theme = t; store.set("theme", t);
  $("theme-btn").innerHTML = t === "light" ? SUN : t === "dark" ? MOON : AUTO;
  $("theme-btn").title = "Motyw: " + { auto: "automatyczny", light: "jasny", dark: "ciemny" }[t];
  for (const b of $("theme-seg").querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.t === t);
  styleBase(); lastAlertsKey = ""; refreshAlerts(); for (const mk of markers.values()) mk._h = ""; if (live.haveData || mode === "hist") recompute(); drawTrack()
}
$("theme-btn").onclick = () => setTheme({ auto: "light", light: "dark", dark: "auto" }[themeSetting()]);
$("theme-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTheme(b.dataset.t) });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (themeSetting() === "auto") setTheme("auto") });

/* ---------- wysuwany panel na telefonie ---------- */
const side = $("side"), grab = $("grab"), ORDER = ["peek", "half", "full"];
function setSheet(st) { side.dataset.s = st; side.style.transform = "" }
let drag = null;
grab.addEventListener("pointerdown", e => { if (!mobile()) return; const r = side.getBoundingClientRect(); drag = { y0: e.clientY, off0: r.top - (innerHeight - r.height), moved: false }; side.classList.add("drag"); grab.setPointerCapture(e.pointerId) });
grab.addEventListener("pointermove", e => {
  if (!drag) return; const dy = e.clientY - drag.y0; if (Math.abs(dy) > 6) drag.moved = true;
  const max = side.offsetHeight - parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--peek") || 74);
  side.style.transform = `translateY(${Math.min(max, Math.max(0, drag.off0 + dy))}px)`
});
const endDrag = e => {
  if (!drag) return; side.classList.remove("drag");
  if (!drag.moved) { setSheet(ORDER[(ORDER.indexOf(side.dataset.s) + 1) % 3]); drag = null; return }
  const r = side.getBoundingClientRect(), frac = (r.top - (innerHeight - r.height)) / r.height;
  setSheet(frac < .22 ? "full" : frac < .68 ? "half" : "peek"); drag = null
};
grab.addEventListener("pointerup", endDrag); grab.addEventListener("pointercancel", endDrag);
grab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSheet(ORDER[(ORDER.indexOf(side.dataset.s) + 1) % 3]) } });

/* ---------- start ---------- */
if (mobile()) $("legend").open = false;
requestAnimationFrame(() => setTimeout(() => $("stage").classList.remove("boot"), 80));
let rsT; addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(() => { map.invalidateSize(); if (!userMoved) map.fitBounds(HOME(), homePad()); drawTrack() }, 200) });
document.addEventListener("keydown", e => { if (e.key === "Escape" && selected) select(null) });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r => { swReg = r; initPush() }).catch(() => initPush()); else initPush();
setTheme(themeSetting());
checkServer(); setInterval(checkServer, 120000);
pollRcb(); setInterval(() => { if (!document.hidden) pollRcb() }, 60000);
pollNews(); setInterval(() => { if (!document.hidden) pollNews() }, 120000);
setInterval(() => { if (!document.hidden) renderFlights() }, 60000);
connect();
pollAlerts(); pollMsgs();
setInterval(() => { if (!document.hidden) pollAlerts() }, 30000);
setInterval(() => { if (!document.hidden) pollMsgs() }, 20000);
setInterval(() => { if (live.haveData && mode === "live" && !document.hidden) recompute() }, 2000);
refreshAlerts(); setLabel(); loadHistory(); drawTrack();
