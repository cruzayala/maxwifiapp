# Deploy a Railway

## Resumen de la arquitectura

```
[Navegador / cliente bloqueado]
       ↓ HTTPS
[Railway: tu-app.up.railway.app]
   - Express + Angular static build
   - SQLite con Volume montado en /data
   - Sync loop cada 2 min Wisphub+MikroTik
   - Captive portal /captive
       ↓ RouterOS API binaria 8728
[MikroTik 154.88.128.162-165 (IP publica)]
```

## Paso 1 — Verificar que el MikroTik acepta Railway

El MikroTik ya tiene whitelisteados los rangos AWS us-east-1 (donde corre Railway) en `/ip/services` para los puertos 8728 (api) y 80/443 (www/www-ssl). Verificar con:

```bash
curl -u "goku:CLAVE" http://192.168.13.1/rest/ip/service \
  | jq '.[] | select(.name == "api") | .address'
```

Debe contener: `35.160.120.126/32, 44.233.151.27/32, 54.184.196.143/32, 52.0.0.0/15, 3.80.0.0/12, 44.192.0.0/10`, etc.

## Paso 2 — Crear proyecto en Railway

```bash
# Si no tienes Railway CLI:
npm i -g @railway/cli
railway login

# En la carpeta del proyecto:
cd "C:\Users\maxim\Desktop\wishubapp\wishub-admin"
railway init
```

## Paso 3 — Agregar Volume para la BD

En el dashboard de Railway:
1. Click en el servicio
2. **Settings → Volumes → Add Volume**
3. Mount path: `/data`
4. Size: 1 GB (suficiente)

## Paso 4 — Configurar variables de entorno en Railway

En **Settings → Variables** del servicio, agrega:

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | `file:/data/data.db` | usa el Volume |
| `WISPHUB_API_KEY` | `g1D2HhRY.lqRC3sGv4TosFEONheqBo4pvY8BfsTeZ` | tu API key |
| `MIKROTIK_HOST` | `154.88.128.162` | IP publica del MikroTik |
| `MIKROTIK_USER` | `goku` | |
| `MIKROTIK_PASS` | `MAXCELY6805` | |
| `MIKROTIK_PORT` | `8728` | |
| `ACCESS_PIN` | `<algo-secreto-12-chars>` | **OBLIGATORIO** sin esto cualquiera entra |
| `NODE_ENV` | `production` | |
| `CAPTIVE_AUTOCONFIG` | `true` | reescribe NAT con IP de Railway al boot |
| `CAPTIVE_PORT` | `7400` | puerto interno (Railway expone 443/80) |
| `SYNC_INTERVAL_MS` | `120000` | 2 min entre syncs |
| `WHATSAPP_AUTOSTART` | `false` | activar luego con `POST /wa/connect` desde la UI |

## Paso 5 — Deploy

```bash
railway up
```

El deploy:
1. Buildea Docker (multi-stage)
2. Corre `npx prisma db push` en `/data/data.db` (crea tablas en el Volume)
3. Arranca `node server.js`
4. Sync loop arranca, trae 380 clientes de Wisphub
5. **`autoConfigureCaptive`** detecta IP publica del contenedor (via `ipify.org`) y reescribe las reglas NAT del MikroTik para apuntar al backend

## Paso 6 — Verificar

```bash
curl https://tu-app.up.railway.app/health
# {"status":"ok","database":"connected","mikrotik":"connected",...}

curl https://tu-app.up.railway.app/sync/status
# {"running":true,"intervalMs":120000,"lastSyncResult":{"wisphub":380,...}}
```

## Paso 7 — Activar WhatsApp (opcional)

Si quieres notificaciones de bloqueo via WA:
1. Abre la app: `https://tu-app.up.railway.app`
2. Login con `ACCESS_PIN`
3. Ve a `/whatsapp`
4. Click "Conectar" → escanea el QR con tu WhatsApp

## Paso 8 — Probar el bloqueo

1. Abre `/clients` en la app
2. Busca un cliente
3. Click "Bloquear" o "Moroso"
4. La IP entra al address-list del MikroTik
5. Las conexiones existentes del cliente se cierran (`killConnectionsFrom`)
6. Si el cliente abre HTTP, MikroTik le redirige al captive en Railway
7. Para reactivar: click "Reactivar"

## Notas importantes

### IP publica de Railway puede cambiar

El servicio Railway expone una URL HTTPS (`*.up.railway.app`), pero la IP publica del contenedor cambia entre redeploys. `CAPTIVE_AUTOCONFIG=true` resuelve esto: al boot, el server detecta su IP via `ipify.org` y reescribe `to-addresses` de la regla NAT del MikroTik.

### Captive con HTTPS

El captive portal se sirve por HTTP plano dentro del contenedor (puerto 7400) porque MikroTik DST-NAT no puede manipular TLS. Railway le pone HTTPS por fuera. Cuando un cliente bloqueado accede a `http://google.com`, el MikroTik DNATea a `<railway-ip>:7400` → Railway lo recibe y lo enruta al backend. **No funciona si el cliente intenta `https://...`** — vera un error de cert (esperado).

### Backup de la BD

Para descargar la SQLite desde Railway:
```bash
railway run cat /data/data.db > backup-$(date +%F).db
```
