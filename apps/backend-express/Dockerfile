# Backend Express SDL.
#
# Profil pengerasan disamakan dengan service `api` milik Go di compose.dev.yaml:
# read_only, cap_drop ALL, no-new-privileges. Node butuh lebih banyak direktori
# tulis daripada binary Go statis, jadi tmpfs-nya disiapkan eksplisit di compose
# — BUKAN dengan melonggarkan read_only.
FROM node:24.22.0-alpine3.24 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.22.0-alpine3.24
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN addgroup -S sdl && adduser -S -G sdl sdl && chown -R sdl:sdl /app
USER sdl
EXPOSE 8080
ENTRYPOINT ["node", "src/server.js"]
