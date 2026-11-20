# Strażnik Nieba

Radarowa mapa Polski i Ukrainy z zagrożeniami powietrznymi na żywo: drony, pociski, bomby KAB, MiG-31K oraz alarmy w obwodach i rejonach Ukrainy. Pokazuje tory lotu, kurs, prędkość i odległość każdego obiektu do granicy Polski.

Strona: https://kacper22049912.github.io/straznik-nieba/

## Co potrafi

- **Na żywo**: dane z otwartego API [NEPTUN](https://neptun.in.ua/). Najpierw przez WebSocket, potem zapytaniami co 10 s, a awaryjnie z kopii na własnym workerze.
- **Szczegóły obiektu**: po kliknięciu widać kurs, prędkość, niepewność pozycji, pewność danych, przewidywaną trasę na 30 minut i czas dolotu do granicy.
- **Oś czasu**: przewijanie i odtwarzanie ostatnich 3–24 godzin. Wysokość słupka to liczba obiektów; czerwony słupek oznacza obiekt w pobliżu Polski; czerwona kreska u góry oznacza alarm przy granicy.
- **Powiadomienia w tle**: Web Push działa także przy zamkniętej aplikacji. Na iPhonie trzeba najpierw dodać stronę do ekranu początkowego (iOS 16.4 lub nowszy).
- **Aplikacja na telefon (PWA)**: można ją zainstalować z przeglądarki.

## Jak to działa

```
NEPTUN ──► Cloudflare Worker (co minutę) ──► baza D1: historia, subskrypcje
                 │                                  
                 └──► Web Push ──► telefon (sw.js pobiera treść z /api/inbox)
NEPTUN ──► przeglądarka (WebSocket / REST) ──► mapa
```

- `site/`: strona na GitHub Pages (`index.html`, `app.js`, `sw.js`, ikony, granice).
- `worker/`: Cloudflare Worker (`src/index.js`). Co minutę pobiera dane, zapisuje migawkę do osi czasu i wysyła powiadomienia. Klucze VAPID tworzy sam przy pierwszym uruchomieniu i trzyma w bazie.
- `.github/workflows/deploy.yml`: każdy push na `main` wdraża workera, a potem stronę z jego adresem.

## Konfiguracja powiadomień w tle (jednorazowo)

1. Załóż darmowe konto na https://dash.cloudflare.com i raz otwórz **Workers & Pages**, żeby powstała subdomena `*.workers.dev`.
2. Utwórz token API: **My Profile → API Tokens → Create Token → szablon „Edit Cloudflare Workers”**. Dodaj w nim uprawnienie **Account → D1 → Edit**.
3. Skopiuj **Account ID** (prawa kolumna na stronie głównej konta lub w Workers & Pages).
4. W repozytorium na GitHubie: **Settings → Secrets and variables → Actions → New repository secret**. Dodaj:
   - `CLOUDFLARE_API_TOKEN`: token z punktu 2,
   - `CLOUDFLARE_ACCOUNT_ID`: identyfikator z punktu 3.
5. **Actions → Wdrożenie (worker + strona) → Run workflow**.

Bez tych sekretów strona działa normalnie. Nie ma wtedy tylko powiadomień w tle i historii z serwera; oś czasu zapisuje się lokalnie od otwarcia strony.

Darmowy plan Cloudflare wystarcza: worker uruchamia się 1440 razy na dobę, a historia z 48 godzin zajmuje kilka MB w D1.

## Ważne

To nie jest oficjalny system ostrzegania. Pozycje są przybliżone i mogą być opóźnione. W Polsce kieruj się komunikatami RCB (Alert RCB) i Dowództwa Operacyjnego RSZ.

Dane: [Карта повітряних тривог — NEPTUN](https://neptun.in.ua/)
