#!/bin/sh
set -e

# Banco SQLite persiste no volume montado em /app/tmp
DB_DIR="/app/tmp"
mkdir -p "$DB_DIR"

echo "[entrypoint] aplicando migrations..."
node ace migration:run --force

# Semeia apenas no primeiro boot (marcador no volume), para não duplicar dados
if [ ! -f "$DB_DIR/.seeded" ]; then
  echo "[entrypoint] populando dados de demonstração (primeiro boot)..."
  node ace db:seed
  touch "$DB_DIR/.seeded"
else
  echo "[entrypoint] dados já populados — pulando seed."
fi

echo "[entrypoint] iniciando servidor na porta ${PORT:-3333}..."
exec node bin/server.js
