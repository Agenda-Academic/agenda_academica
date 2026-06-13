# syntax=docker/dockerfile:1

# ----- build -----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# NEXT_PUBLIC_API_URL é embutido no bundle (chamadas partem do navegador).
ARG NEXT_PUBLIC_API_URL=http://localhost:3333/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# ----- production: roda o servidor standalone -----
FROM node:24-slim AS production
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
