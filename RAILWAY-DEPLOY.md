# Deploy portable en Railway

## Arquitectura

```text
Navegador -> HTTPS -> Express + Angular
                         |
                         +-> SQLite persistente en /data/data.db
                         +-> WispHub API
                         +-> MikroTik RouterOS API
                         +-> OLT ZTE C320

PC tecnica -> ONU Studio local -> API del entorno Railway
```

## Crear el servicio

```powershell
npm i -g @railway/cli
railway login
railway init
railway up --detach -m "Initial ISP Max deployment"
```

Railway usa `Dockerfile`, `railway.json` y `npm run start:prod`.

## SQLite persistente

1. Agrega un volumen al servicio.
2. Montalo en `/data`.
3. Configura `DATABASE_URL=file:/data/data.db`.

Sin volumen, un nuevo despliegue puede perder la base SQLite. La sincronizacion actualiza y agrega registros; no debe vaciar la base.

## Variables principales

```text
NODE_ENV=production
DATABASE_URL=file:/data/data.db
PUBLIC_APP_URL=https://<TU-DOMINIO-O-RAILWAY-DOMAIN>
WISPHUB_API_KEY=<SECRETO-WISPHUB>
ADMIN_USERNAME=<USUARIO-ADMIN>
ADMIN_PASSWORD=<CLAVE-ADMIN-LARGA>
MIKROTIK_ENABLED=true
MIKROTIK_HOST=<HOST-MIKROTIK>
MIKROTIK_PORT=8728
MIKROTIK_USER=<USUARIO-MIKROTIK>
MIKROTIK_PASS=<CLAVE-MIKROTIK>
OLT_ENABLED=true
OLT_HOST=<HOST-OLT>
OLT_PORT=23
OLT_USER=<USUARIO-OLT>
OLT_PASS=<CLAVE-OLT>
SURVEY_REMINDERS_ENABLED=false
```

El inventario completo y valores locales seguros estan en `.env.example`.

## Cambiar de entorno

No necesitas modificar codigo. Replica las variables y el volumen, cambia `PUBLIC_APP_URL` y despliega.

En cada PC con ONU Studio actualiza:

```text
ISP_MAX_CLOUD_URL=https://<NUEVO-ENTORNO>
ONU_ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200,https://<NUEVO-ENTORNO>
```

Luego reinicia el agente local.

## Verificacion

```powershell
Invoke-RestMethod https://<TU-ENTORNO>/health
railway deployment list --limit 5 --json
railway logs --lines 200 --json
```

Comprueba SQLite, sincronizacion WispHub, MikroTik, OLT y el volumen antes de retirar el entorno anterior.
