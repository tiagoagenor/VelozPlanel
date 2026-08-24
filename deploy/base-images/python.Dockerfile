# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Imagem BASE Python do VelozPlanel = python:<v>-slim (Debian) + git/toolchain.
#   docker build -f python.Dockerfile --build-arg PYTHON_VERSION=3.12 -t velozplanel/python:3.12 .
# Usada como imagem do container EFÊMERO de build (git clone + pip install). O
# app em si roda do python:<v>-slim oficial; esta base só precisa de git + gcc
# (wheels que compilam: psycopg2, cryptography, etc.) + gunicorn.
# ─────────────────────────────────────────────────────────────────────────────
ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates build-essential tini \
      vim nano openssh-client openssh-sftp-server; \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir gunicorn whitenoise

# `python` como alias de `python3` (alguns comandos assumem `python`).
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python || true
