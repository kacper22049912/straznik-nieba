// Status polskich lotnisk wg doniesień mediów (TVN24, RMF24, Polsat News) i PAŻP.
// Zamknięcie: „wstrzymano ruch”, „zamknięte lotnisko”, „ewakuacja wieży”; otwarcie: „przywrócono / wznowiono ruch”.
// To nie są oficjalne dane NOTAM, tylko najnowsza wzmianka w mediach.
export const AIRPORTS = [
  ["EPRZ", "Rzeszów-Jasionka", 50.110, 22.019, /rzeszow|jasionk/i],
  ["EPLB", "Lublin", 51.240, 22.714, /lublin|lubelsk\w* lotnisk|świdnik/i],
  ["EPWA", "Warszawa-Chopin", 52.166, 20.967, /chopin|okęci|warszawsk\w* lotnisk|lotnisk\w* w warszawie/i],
  ["EPMO", "Warszawa-Modlin", 52.451, 20.652, /modlin/i],
  ["EPKK", "Kraków-Balice", 50.078, 19.785, /balic|krakowsk\w* lotnisk|lotnisk\w* w krakowie/i],
  ["EPKT", "Katowice-Pyrzowice", 50.474, 19.080, /pyrzowic|katowick\w* lotnisk/i],
  ["EPGD", "Gdańsk", 54.378, 18.466, /gdańsk\w* lotnisk|lotnisk\w* w gdańsku|rębiechow/i],
  ["EPPO", "Poznań-Ławica", 52.421, 16.826, /ławic|poznańsk\w* lotnisk/i],
  ["EPWR", "Wrocław", 51.103, 16.886, /wrocławsk\w* lotnisk|lotnisk\w* we wrocławiu|strachowic/i],
  ["EPSY", "Olsztyn-Mazury", 53.482, 20.938, /szyman|olsztyn\w*-mazury|mazury airport/i],
  ["EPBY", "Bydgoszcz", 53.097, 17.978, /bydgosk\w* lotnisk|lotnisk\w* w bydgoszczy/i],
  ["EPLL", "Łódź", 51.722, 19.398, /łódzk\w* lotnisk|lotnisk\w* w łodzi|lublinek/i],
  ["EPRA", "Radom", 51.389, 21.213, /radomsk\w* lotnisk|lotnisk\w* w radomiu/i],
  ["EPSC", "Szczecin-Goleniów", 53.585, 14.902, /goleni[oó]w/i],
];
const AVIATION = /(lotnisk|port\w* lotnicz|ruch\w* lotnicz|PAŻP|wież\w* kontroli|kontroler\w* ruchu|samolot\w* nie)/i;
const CLOSED = /(zamknię\w*|wstrzyma\w*|zawieszon\w*|ewakuacj\w* wieży|nie przyjmuje|nie startuj|wstrzymanie ruchu|ograniczeni\w* ruchu)/i;
const OPEN = /(przywróc\w*|wznowi\w*|otwart\w*|ponownie (?:działa|otwar)|normalnie działa|bez utrudnień)/i;

export function airportStatus(prev, items) {
  const state = new Map((prev && prev.items || []).map(a => [a.code, a]));
  for (const it of items.slice().sort((a, b) => a.t - b.t)) {
    const s = it.title + ". " + (it.desc || "");
    if (!AVIATION.test(s)) continue;
    const open = OPEN.test(it.title) || (!CLOSED.test(it.title) && OPEN.test(s));
    const closed = !open && CLOSED.test(s);
    if (!open && !closed) continue;
    for (const [code, name, lat, lon, re] of AIRPORTS) {
      if (!re.test(s)) continue;
      const cur = state.get(code);
      if (cur && cur.t >= it.t) continue;
      state.set(code, { code, name, lat, lon, state: open ? "open" : "closed", t: it.t, title: it.title, link: it.link, src: it.src });
    }
  }
  return { t: Date.now(), items: [...state.values()].filter(a => a.t > Date.now() - 7 * 864e5) };
}
