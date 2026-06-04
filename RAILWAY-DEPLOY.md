# Deploy a Railway

## Arquitectura

```
[Navegador / cliente bloqueado]
       -> HTTPS
[Railway: app.up.railway.app]
   - Express + Angular static build
   - PostgreSQL administrado por Railway
   - Sync loop WispHub + MikroTik
   - Captive portal /captive
       -> RouterOS API 8728
[MikroTik con IP publica]
```

## 1. Crear proyecto

```bash
npm i -g @railway/cli
railway login
cd "C:\Users\maxim\Desktop\wishubapp\wishub-admin"
railway init
```

## 2. Agregar PostgreSQL

En Railway: **New > Database > PostgreSQL**.

Railway debe inyectar `DATABASE_URL` al servicio de la app. Si no aparece automaticamente, referencia la variable del servicio PostgreSQL desde las variables de la app.

## 3. Variables de entorno

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | PostgreSQL de Railway |
| `WISPHUB_API_KEY` | `<tu-api-key>` | API key de WispHub |
| `MIKROTIK_HOST` | `<ip-publica-mikrotik>` | IP publica del MikroTik |
| `MIKROTIK_USER` | `<usuario-mikrotik>` | Usuario RouterOS |
| `MIKROTIK_PASS` | `<clave-mikrotik>` | Clave RouterOS |
| `MIKROTIK_PORT` | `8728` | API RouterOS |
| `ADMIN_USERNAME` | `<usuario-admin>` | Obligatorio si no hay usuarios |
| `ADMIN_PASSWORD` | `<clave-admin-larga>` | Minimo 8 caracteres |
| `ADMIN_FULL_NAME` | `Super Administrador` | Opcional |
| `NODE_ENV` | `production` | Produccion |
| `CAPTIVE_AUTOCONFIG` | `true` | Reconfigura NAT con la IP de salida |
| `CAPTIVE_PORT` | `7400` | Puerto interno |
| `SYNC_INTERVAL_MS` | `120000` | 2 minutos |
| `WHATSAPP_AUTOSTART` | `false` | Conectar luego desde la UI |

## 4. Deploy

```bash
railway up
```

El start command de Railway ejecuta:

```bash
npm run start:prod
```

Eso aplica el schema con `prisma db push --skip-generate` sin `--accept-data-loss` y luego inicia `node server.js`.

## 5. Verificar

```bash
curl https://tu-app.up.railway.app/health
curl https://tu-app.up.railway.app/sync/status
```

## 6. WhatsApp

1. Abre `https://tu-app.up.railway.app`
2. Entra con `ADMIN_USERNAME` y `ADMIN_PASSWORD`
3. Ve a `/whatsapp`
4. Presiona "Conectar" y escanea el QR

## Notas

La API key de WispHub nunca debe ir en Angular ni en `environment.ts`; el navegador habla con Express y Express agrega `WISPHUB_API_KEY` al proxy hacia WispHub.

Para backups, usa snapshots de PostgreSQL en Railway o `pg_dump` con `DATABASE_URL`.
