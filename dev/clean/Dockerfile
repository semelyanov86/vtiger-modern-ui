# Web server of the clean Vtiger 8.4.0 stand (docs/environments.md §2): Apache + mod_php (mod_rewrite for the
# .htaccess files of the CRM) with the extensions the 8.4.0 installer checks (modules/Install/models/Utils.php).
# The CRM code is not part of the image: dev/clean/clean.sh unpacks the official release archive into a volume.
#
# The base image is pinned by digest in compose.yaml. Debian bookworm, because the imap extension needs
# libc-client, which Debian trixie no longer ships. PHP >= 8.4 has imap only in PECL (IMAP=pecl).
ARG BASE
FROM ${BASE}

ARG IMAP=bundled
ARG IMAP_PECL_VERSION=1.0.3

RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends \
		libc-client-dev libkrb5-dev libfreetype6-dev libjpeg62-turbo-dev libpng-dev libzip-dev libicu-dev; \
	docker-php-ext-configure gd --with-freetype --with-jpeg; \
	docker-php-ext-install -j"$(nproc)" mysqli gd zip intl; \
	if [ "$IMAP" = bundled ]; then \
		docker-php-ext-configure imap --with-kerberos --with-imap-ssl; \
		docker-php-ext-install -j"$(nproc)" imap; \
	else \
		printf 'yes\nyes\n' | MAKEFLAGS="-j$(nproc)" pecl install "imap-${IMAP_PECL_VERSION}"; \
		docker-php-ext-enable imap; \
	fi; \
	php -m | grep -q '^Zend OPcache$' || docker-php-ext-enable opcache; \
	a2enmod rewrite; \
	rm -rf /var/lib/apt/lists/* /tmp/pear; \
	php -r 'foreach (["mysqli","imap","curl","gd","zip","intl","mbstring","xml","simplexml","openssl","zlib"] as $e) { if (!extension_loaded($e)) { fwrite(STDERR, "missing $e\n"); exit(1); } }'

COPY php.ini /usr/local/etc/php/conf.d/zz-vtiger.ini
