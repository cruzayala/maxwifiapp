# ═══════════════════════════════════════════════════════════════
# WispHub Admin - Multi-stage Docker build
# ═══════════════════════════════════════════════════════════════

# ─── BUILD STAGE ───
FROM node:22-alpine AS build
WORKDIR /app

# Git necesario para algunas deps
RUN apk add --no-cache git python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

# Generar Prisma Client
RUN npx prisma generate

# Build Angular
RUN npx ng build

# ─── RUNTIME STAGE ───
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache git

COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Solo deps de producción
RUN npm ci --omit=dev

# Directorio para DB persistente (Railway monta el Volume aqui externamente)
RUN mkdir -p /data

EXPOSE 7400
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --skip-generate && node server.js"]
