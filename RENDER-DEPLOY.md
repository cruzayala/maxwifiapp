# Deploy portable en Render

El mismo codigo puede ejecutarse en Render, Railway, Docker local u otro proveedor. Los secretos y dominios se configuran por variables; nunca deben escribirse en este archivo.

## Requisitos

- Repositorio disponible en el proveedor Git seleccionado.
- Volumen persistente montado en `/data` para SQLite.
- Acceso MikroTik limitado a las direcciones de salida verificadas del servicio.
- Port forwarding hacia la API de RouterOS cuando no exista una VPN privada.

## Variables

```text
NODE_ENV=production
DATABASE_URL=file:/data/data.db
PUBLIC_APP_URL=https://<TU-SERVICIO>.onrender.com
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

Consulta `.env.example` para el inventario completo. Configura las credenciales como secretos del proveedor y no las incluyas en Git.

## Servicio

1. Crea un Web Service usando el `Dockerfile` del repositorio.
2. Monta el volumen persistente en `/data`.
3. Agrega las variables anteriores.
4. Despliega y verifica `https://<TU-SERVICIO>.onrender.com/health`.
5. Confirma en los registros que SQLite, WispHub, MikroTik y OLT tengan el estado esperado.

## Agente ONU

En la PC técnica configura `onu-provisioner/.env` o `%LOCALAPPDATA%\ISP Max\ONU Studio\.env`:

```text
ISP_MAX_CLOUD_URL=https://<TU-SERVICIO>.onrender.com
ONU_ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200,https://<TU-SERVICIO>.onrender.com
```

Reinicia ONU Studio después de cambiar el origen autorizado.

## MikroTik

No reutilices listas antiguas de IP. Consulta las direcciones de salida reales del nuevo entorno y limita RouterOS a esas direcciones o usa una VPN privada.

## Respaldo

Descarga el respaldo desde Configuración o copia `/data/data.db` mediante las herramientas del proveedor. No ejecutes la aplicación sin volumen persistente en producción.
