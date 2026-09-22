# ISP Max

Panel de operación del ISP: clientes y cobranza (WispHub), red (MikroTik, OLT ZTE C320,
TR-069), WhatsApp, encuestas, inventario, gastos y nómina. Se usa desde la web, desde la
app Android y, para configurar ONU en campo, desde ONU Studio en una PC técnica.

```text
Navegador / Android ──HTTPS──> Express (server.js) ──> SQLite (Prisma)
                                   │                 ├─> WispHub API
                                   │                 ├─> MikroTik RouterOS API
                                   │                 └─> OLT ZTE C320 (telnet)
PC técnica ── ONU Studio ──────────┘  (agente: /agent-api, /tr069-api)
```

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `server.js`, `lib/` | Servidor Express: rutas web, `/mobile/v1` para Android y lógica de dominio |
| `src/app/` | Web Angular (páginas en `pages/`, servicios en `services/`) |
| `shared/` | Plantilla de facturas/recibos compartida por la web y el servidor |
| `prisma/` | Esquema de la base de datos SQLite |
| `android/` | App Android nativa (Kotlin + Compose) |
| `onu-studio-net/` | ONU Studio para Windows (.NET): asistente local de ONU y agente TR-069 |
| `tr069-acs/` | GenieACS local (Docker) para las pruebas TR-069 |
| `agent-downloads/` | Instaladores que el servidor ofrece para descargar (no se versionan los binarios) |
| `scripts/` | Utilidades: build de facturas, verificación de despliegue, APK firmada y herramientas de MikroTik |
| `test/` | Pruebas del servidor (`node --test`) |
| `docs/` | Arquitectura, OLT, TR-069, paridad Android y evidencias de QA (`docs/qa/`) |

## Desarrollo local

```bash
npm install
cp .env.example .env        # completa las variables; en local desactiva MikroTik, OLT y WhatsApp
npx prisma db push
npm run start:dev           # web en :4200 y servidor en :7400
```

## Pruebas y build

```bash
npm test                    # pruebas del servidor
npm run build               # web de producción
npm run check:portable      # verifica que no haya dominios ni claves del entorno actual
```

Android: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`.
La APK firmada se genera con `scripts/build-android-private.ps1` (la firma vive fuera del repositorio).

## Despliegue

Producción corre en Railway con el `Dockerfile` y `railway.json`: ver `RAILWAY-DEPLOY.md`.

```bash
railway up --service "ISP max" --environment production --detach
```
