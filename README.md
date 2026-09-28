# PeBol – strona firmowa

Jednostronicowa strona firmy sprzątającej PeBol z Częstochowy. Zwykły HTML i CSS bez kroku budowania. Czcionki (Archivo, Atkinson Hyperlegible) są hostowane lokalnie.

```
site/            strona (index.html, assets/)
apache/          konfiguracja Apache (kompresja, cache, nagłówki)
Dockerfile       obraz httpd:2.4-alpine z gotową stroną
```

## Uruchomienie w Dockerze

```sh
docker build -t pebol .
docker run --rm -p 8080:80 pebol
```

Strona będzie pod adresem http://localhost:8080.

## Podgląd bez Dockera

Otwórz `site/index.html` w przeglądarce albo uruchom `npx http-server site`.
