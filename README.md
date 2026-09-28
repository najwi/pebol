# PeBol – strona firmowa

Jednostronicowa strona firmy sprzątającej PeBol z Częstochowy. Zwykły HTML i CSS bez kroku budowania. Czcionki (Archivo, Atkinson Hyperlegible) są hostowane lokalnie.

```
site/            strona (index.html, assets/)
apache/          konfiguracja Apache (kompresja, cache, nagłówki)
Dockerfile       obraz httpd:2.4-alpine z gotową stroną
.github/         wdrożenie na GitHub Pages
```

## Uruchomienie w Dockerze

```sh
docker build -t pebol .
docker run --rm -p 8080:80 pebol
```

Strona będzie pod adresem http://localhost:8080.

## GitHub Pages

Workflow `.github/workflows/pages.yml` publikuje katalog `site/` przy każdym pushu zmian w stronie. Jednorazowo trzeba włączyć Pages w ustawieniach repozytorium: **Settings → Pages → Source: GitHub Actions**. Na prywatnym repozytorium Pages wymaga płatnego planu GitHub (Pro lub wyżej). Na darmowym planie repozytorium musi być publiczne.

Strona będzie pod adresem https://najwi.github.io/pebol/.

## Podgląd bez Dockera

Otwórz `site/index.html` w przeglądarce albo uruchom `npx http-server site`.
