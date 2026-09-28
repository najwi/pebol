# PeBol – strona firmowa

Jednostronicowa strona firmy sprzątającej PeBol z Częstochowy, wersja z efektami WebGL (three.js): zaparowana szyba w nagłówku, przez którą prześwituje rozmyty napis, a po szybie spływają krople. Szybę przeciera się kursorem albo palcem (na telefonie ruchem na boki). Bańki mydlane pękają od kliknięcia lub dotknięcia, a ich krople zostają na szybie. Na telefonach z Androidem bańki reagują na przechylenie, a pęknięcie daje krótką wibrację. Czcionki (Archivo, Atkinson Hyperlegible) i biblioteka three.js są hostowane lokalnie.

```
site/            strona (index.html, assets/), gotowa do serwowania
src/             kod JS (glass.js: szyba, bubbles.js: bańki, proof.js: zdjęcia przed/po, main.js: interakcje), budowany do site/assets/js/app.js
apache/          konfiguracja Apache (kompresja, cache, nagłówki)
Dockerfile       obraz httpd:2.4-alpine z gotową stroną
.github/         wdrożenie na GitHub Pages
```

## Zmiany w efektach

Kod w `src/` jest pakowany przez esbuild. Zbudowany plik `site/assets/js/app.js` jest w repozytorium, więc Docker i Pages nie potrzebują Node.

```sh
npm install
npm run build    # albo npm run watch
```

## Uruchomienie w Dockerze

```sh
docker build -t pebol .
docker run --rm -p 8080:80 pebol
```

Strona będzie pod adresem http://localhost:8080.

## GitHub Pages

Workflow `.github/workflows/pages.yml` składa jedną witrynę z dwóch gałęzi: `site/` z `main` trafia pod adres główny, a `site/` z gałęzi `claude/pebol-threejs-bqhxc0` pod `/3d/`. Uruchamia się przy pushu zmian w stronie na którejkolwiek z nich. Jednorazowo trzeba włączyć Pages w ustawieniach repozytorium: **Settings → Pages → Source: GitHub Actions**. Na prywatnym repozytorium Pages wymaga płatnego planu GitHub (Pro lub wyżej). Na darmowym planie repozytorium musi być publiczne.

Adresy: https://najwi.github.io/pebol/ (main) i https://najwi.github.io/pebol/3d/ (wersja three.js).

## Podgląd bez Dockera

Otwórz `site/index.html` w przeglądarce albo uruchom `npx http-server site`.
