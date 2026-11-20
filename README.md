# Strażnik Nieba

Radarowa mapa Polski i Ukrainy z zagrożeniami powietrznymi na żywo: drony, pociski, bomby KAB, MiG-31K oraz alarmy w obwodach i rejonach Ukrainy. Pokazuje tory lotu, kurs, prędkość i odległość każdego obiektu do granicy Polski.

Strona: adres workera `https://straznik-nieba.<twoja-subdomena>.workers.dev`

## Co potrafi

- **Na żywo**: dane z otwartego API [NEPTUN](https://neptun.in.ua/). Najpierw przez WebSocket, potem zapytaniami co 10 s, a awaryjnie z kopii na własnym workerze.
- **Szczegóły obiektu**: po kliknięciu widać kurs, prędkość, niepewność pozycji, pewność danych, przewidywaną trasę na 30 minut i czas dolotu do granicy.
- **Oś czasu**: przewijanie i odtwarzanie ostatnich 3–24 godzin. Wysokość słupka to liczba obiektów; czerwony słupek oznacza obiekt w pobliżu Polski; czerwona kreska u góry oznacza alarm przy granicy.
- **Powiadomienia w tle**: Web Push działa także przy zamkniętej aplikacji. Na iPhonie trzeba najpierw dodać stronę do ekranu początkowego (iOS 16.4 lub nowszy).
- **Aplikacja na telefon (PWA)**: można ją zainstalować z przeglądarki.

## Jak to działa

Wszystko działa w jednym Cloudflare Workerze:

- `site/`: pliki strony (`index.html`, `app.js`, `sw.js`, ikony, granice) serwowane jako statyczne zasoby workera,
- `worker/src/index.js`: API pod `/api/*` oraz zadanie uruchamiane co minutę. Pobiera dane z NEPTUN, zapisuje migawkę do osi czasu w bazie D1 i wysyła powiadomienia Web Push. Klucze VAPID tworzy sam przy pierwszym uruchomieniu,
- `wrangler.toml`: konfiguracja workera (zasoby, harmonogram, baza D1).

```
NEPTUN ──► worker (co minutę) ──► D1: historia, subskrypcje ──► Web Push ──► telefon
NEPTUN ──► przeglądarka (WebSocket / REST) ──► mapa
```

Cloudflare buduje i wdraża workera z tego repozytorium przy każdym pushu na `main` (Workers Builds).

## Pierwsza konfiguracja (jednorazowo)

1. Na https://dash.cloudflare.com wejdź w **Storage & Databases → D1 → Create** i utwórz bazę o nazwie `straznik-nieba`. Jej **Database ID** wpisz w `wrangler.toml` w miejsce `__D1_ID__`.
2. Wejdź w **Workers & Pages → Create → Import a repository**, połącz GitHuba i wybierz to repozytorium. Nazwa projektu: `straznik-nieba`. Ustawienia budowania zostaw domyślne (polecenie wdrożenia: `npx wrangler deploy`, katalog główny: `/`).
3. Kliknij **Deploy**. Adres aplikacji pojawi się na stronie workera.

Lokalnie: `npm install`, potem `npm run dev`.

## Ważne

To nie jest oficjalny system ostrzegania. Pozycje są przybliżone i mogą być opóźnione. W Polsce kieruj się komunikatami RCB (Alert RCB) i Dowództwa Operacyjnego RSZ.

Dane: [Карта повітряних тривог — NEPTUN](https://neptun.in.ua/)
