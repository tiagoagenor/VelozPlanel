# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Imagem BASE PHP do VelozPlanel = imagem oficial + composer + extensões + tools.
#   docker build -f php.Dockerfile --build-arg PHP_VERSION=8.3 -t velozplanel/php:8.3 .
# O agente usa velozplanel/php:<v> se existir; senão cai na php:<v>-cli crua.
# ─────────────────────────────────────────────────────────────────────────────
ARG PHP_VERSION=8.3
FROM php:${PHP_VERSION}-cli

# Composer (última 2.x, direto da imagem oficial)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Ferramentas de SO (Essencial+Recomendado) + libs -dev p/ compilar as extensões
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      git unzip zip wget rsync ca-certificates \
      libzip-dev libpng-dev libjpeg-dev libfreetype-dev libicu-dev libxml2-dev; \
    rm -rf /var/lib/apt/lists/*

# Extensões PHP nativas (Essencial + Recomendado)
#   Essencial: pdo_mysql mysqli zip gd intl bcmath exif   Recomendado: soap pcntl
RUN set -eux; \
    docker-php-ext-configure gd --with-freetype --with-jpeg; \
    docker-php-ext-install -j"$(nproc)" \
      pdo_mysql mysqli zip gd intl bcmath exif soap pcntl

# Extensões PECL (Recomendado): igbinary + redis
RUN set -eux; \
    pecl install igbinary redis; \
    docker-php-ext-enable igbinary redis

# WP-CLI (Recomendado)
RUN set -eux; \
    curl -sSLo /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar; \
    chmod +x /usr/local/bin/wp

# OPcache tuning (Recomendado) — só web (enable_cli=0)
RUN { \
      echo 'opcache.enable=1'; \
      echo 'opcache.enable_cli=0'; \
      echo 'opcache.memory_consumption=128'; \
      echo 'opcache.max_accelerated_files=10000'; \
      echo 'opcache.validate_timestamps=1'; \
      echo 'opcache.revalidate_freq=2'; \
    } > /usr/local/etc/php/conf.d/zz-velozplanel-opcache.ini

# Editores (pedido do dono: vim + nano em todo container).
RUN apt-get update && apt-get install -y --no-install-recommends vim nano openssh-sftp-server openssh-client \
 && rm -rf /var/lib/apt/lists/*

# ── Node via nvm (system-wide). Todo ambiente PHP vem com Node; a versão é
#    trocável no painel e no terminal. Instalado no BUILD (usa internet no host
#    de build, não no nó do cliente). NVM_DIR root-owned em /usr/local/nvm.
ENV NVM_DIR=/usr/local/nvm
ENV VP_NODE_DEFAULT=22
# nvm.sh é script BASH → precisa rodar em bash (o RUN default é dash). O loop de
# symlinks termina em `true` p/ não abortar se algum binário faltar.
RUN mkdir -p "$NVM_DIR" \
 && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash \
 && bash -c '. "$NVM_DIR/nvm.sh" \
      && nvm install "$VP_NODE_DEFAULT" \
      && nvm alias default "$VP_NODE_DEFAULT" \
      && D="$NVM_DIR/versions/node/$(nvm version default)/bin" \
      && for b in node npm npx corepack; do [ -e "$D/$b" ] && ln -sfn "$D/$b" /usr/local/bin/$b; done; true'


# Login shells (bash -il do gateway SSH) enxergam a FUNÇÃO nvm via profile.d;
# comandos não-interativos (build, sh -c) usam os symlinks em /usr/local/bin.
RUN printf '%s\n' \
    'export NVM_DIR=/usr/local/nvm' \
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' \
    '[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"' \
    > /etc/profile.d/nvm.sh

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║ EXTRAS — adicione aqui o que quiser (a base já traz Essencial+Recomendado) ║
# ║  Pacote do SO:     apt-get update && apt-get install -y <pkg> && rm -rf /var/lib/apt/lists/* ║
# ║  Extensão nativa:  docker-php-ext-install <ext>                            ║
# ║  Extensão PECL:    pecl install <ext> && docker-php-ext-enable <ext>       ║
# ║  PostgreSQL:       apt-get install -y libpq-dev && docker-php-ext-install pdo_pgsql pgsql ║
# ║  ImageMagick:      apt-get install -y libmagickwand-dev && pecl install imagick && docker-php-ext-enable imagick ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
# RUN set -eux; apt-get update; apt-get install -y --no-install-recommends SEUS_PACOTES; rm -rf /var/lib/apt/lists/*
