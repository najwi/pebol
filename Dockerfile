FROM httpd:2.4-alpine

# Compression, caching and a few safe headers for the static site
COPY apache/pebol.conf /usr/local/apache2/conf/extra/pebol.conf
RUN sed -i \
      -e 's/^#\(LoadModule deflate_module\)/\1/' \
      -e 's/^#\(LoadModule expires_module\)/\1/' \
      -e 's/^#\(LoadModule headers_module\)/\1/' \
      /usr/local/apache2/conf/httpd.conf \
 && echo 'Include conf/extra/pebol.conf' >> /usr/local/apache2/conf/httpd.conf

COPY site/ /usr/local/apache2/htdocs/

EXPOSE 80
