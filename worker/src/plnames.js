// Polskie nazwy dla danych z Ukrainy: obwody, rejony, miasta i transliteracja nazw miejscowości.
const OBL_PL = { "Вінницька": "winnicki", "Волинська": "wołyński", "Дніпропетровська": "dniepropetrowski", "Донецька": "doniecki", "Житомирська": "żytomierski", "Закарпатська": "zakarpacki", "Запорізька": "zaporoski", "Івано-Франківська": "iwanofrankiwski", "Київська": "kijowski", "Кіровоградська": "kirowohradzki", "Луганська": "ługański", "Львівська": "lwowski", "Миколаївська": "mikołajowski", "Одеська": "odeski", "Полтавська": "połtawski", "Рівненська": "rówieński", "Сумська": "sumski", "Тернопільська": "tarnopolski", "Харківська": "charkowski", "Херсонська": "chersoński", "Хмельницька": "chmielnicki", "Черкаська": "czerkaski", "Чернівецька": "czerniowiecki", "Чернігівська": "czernihowski" };
const CITY_PL = { "Київ": "Kijów", "м. Київ": "Kijów", "Харків": "Charków", "Одеса": "Odessa", "Львів": "Lwów", "Дніпро": "Dniepr", "Запоріжжя": "Zaporoże", "Миколаїв": "Mikołajów", "Херсон": "Chersoń", "Чернігів": "Czernihów", "Суми": "Sumy", "Полтава": "Połtawa", "Житомир": "Żytomierz", "Рівне": "Równe", "Луцьк": "Łuck", "Тернопіль": "Tarnopol", "Хмельницький": "Chmielnicki", "Вінниця": "Winnica", "Черкаси": "Czerkasy", "Кропивницький": "Kropywnycki", "Чернівці": "Czerniowce", "Ужгород": "Użhorod", "Івано-Франківськ": "Iwano-Frankiwsk", "Ковель": "Kowel", "Біла Церква": "Biała Cerkiew", "Кременчук": "Krzemieńczuk", "Кривий Ріг": "Krzywy Róg", "Автономна Республіка Крим": "Krym", "Севастополь": "Sewastopol" };
const TL = { а: "a", б: "b", в: "w", г: "h", ґ: "g", д: "d", е: "e", є: "je", ж: "ż", з: "z", и: "y", і: "i", ї: "ji", й: "j", к: "k", л: "ł", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "ch", ц: "c", ч: "cz", ш: "sz", щ: "szcz", ю: "ju", я: "ja", ы: "y", э: "e", ё: "jo", ъ: "", "'": "", "’": "" };
const SOFT = { н: "ń", с: "ś", ц: "ć", з: "ź", л: "l", т: "t", д: "d" };
export function translit(w) {
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
  return out;
}
export function plRegion(r) { if (!r) return ""; const m = r.match(/^(.+?) область$/); if (m) return OBL_PL[m[1]] ? "obw. " + OBL_PL[m[1]] : translit(r); return CITY_PL[r] || translit(r) }
export function plPlace(x) {
  const loc = x.locality && x.locality !== x.region ? translit(x.locality) : "";
  return [loc, plRegion(x.region)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
}
