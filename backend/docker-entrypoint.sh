#!/bin/sh
set -e

# Pasta do SQLite (docker-compose); no Render o banco é o Postgres do DATABASE_URL
DB_DIR="/app/tmp"
mkdir -p "$DB_DIR"

# No Render a URL pública chega em RENDER_EXTERNAL_URL; vale como APP_URL se ele não foi definido
if [ -z "${APP_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export APP_URL="$RENDER_EXTERNAL_URL"
fi

echo "[entrypoint] aplicando migrations..."
node ace migration:run --force

# Semeia só num banco sem usuários: no Postgres (produção) os dados ficam entre os reinícios,
# e no SQLite do docker-compose o volume guarda o banco
node ace db:seed-if-empty

echo "[entrypoint] iniciando servidor na porta ${PORT:-3333}..."
exec node bin/server.js
