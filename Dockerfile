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
RUN npm run build

# ─── RUNTIME STAGE ───
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache git

COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib ./lib
COPY --from=build /app/agent-downloads ./agent-downloads
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Solo deps de producción
RUN npm ci --omit=dev

# SQLite en Railway: DATABASE_URL apunta al volumen persistente montado en /data
EXPOSE 7400

# La maquina de Railway reporta 32 GB y Node dejaria crecer el heap hasta ~4 GB antes
# de limpiar a fondo (picos de 800 MB). Con este tope limpia antes y se mantiene bajo.
ENV NODE_OPTIONS="--max-old-space-size=512"

# `exec` deja a node como proceso principal: sin npm esperando (65 MB menos) y las
# senales de apagado llegan directo al servidor.
CMD ["sh", "-c", "npx prisma db push --skip-generate && exec node server.js"]
