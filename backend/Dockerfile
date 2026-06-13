# syntax=docker/dockerfile:1

# ----- build: compila o AdonisJS para build/ -----
FROM node:24-slim AS build
WORKDIR /app
# Ferramentas para compilar o better-sqlite3 (módulo nativo) se não houver prebuild
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install
COPY . .
RUN node ace build

# ----- production: roda só o necessário -----
FROM node:24-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/build ./
RUN npm install --omit=dev
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3333
ENTRYPOINT ["docker-entrypoint.sh"]
