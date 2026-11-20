# Strażnik Nieba

Radarowa mapa Polski i Ukrainy z zagrożeniami powietrznymi na żywo: drony, pociski, bomby KAB, alarmy w obwodach i rejonach Ukrainy. Pokazuje tory lotu, kurs i odległość każdego obiektu do granicy Polski.

Strona działa w samej przeglądarce. Dane pobiera bezpośrednio z otwartego API [NEPTUN](https://neptun.in.ua/) (WebSocket, a gdy się nie uda, zapytania co 10 s). Nie potrzebuje serwera ani kluczy.

## Publikacja

Każdy push na gałąź `main` publikuje stronę na GitHub Pages (`.github/workflows/pages.yml`).

## Pliki

- `index.html`: cała aplikacja
- `geo.js`: granice państw (Natural Earth)
- `ua.js`: granice obwodów i rejonów Ukrainy (NEPTUN)

## Ważne

To nie jest oficjalny system ostrzegania. Pozycje są przybliżone i mogą być opóźnione. W Polsce kieruj się komunikatami RCB (Alert RCB) i Dowództwa Operacyjnego RSZ.

Dane: [Карта повітряних тривог — NEPTUN](https://neptun.in.ua/)
