# Deploy a Render

## Pre-requisitos completados
- MikroTik configurado para aceptar API desde Render (3 IPs estables) - **HECHO**
- App en GitHub: `cruzayala/maxwifiapp` - **HECHO**
- render.yaml en el repo - **HECHO**

## Pasos faltantes

### 1. Port forward en Mercusys (192.168.1.1)

Desde el WebFig de tu router casero:
- Advanced → NAT Forwarding → Virtual Servers
- External Port: `8728`
- Internal IP: `192.168.10.1`
- Internal Port: `8728`
- Protocol: TCP

### 2. Crear cuenta nueva en Render

https://dashboard.render.com/register

### 3. Conectar GitHub

Settings → Connect GitHub → autorizar acceso al repo `cruzayala/maxwifiapp`

### 4. Crear servicio Web

1. **New → Web Service**
2. Selecciona el repo `maxwifiapp`
3. Render detecta el `render.yaml` automaticamente
4. Click "Apply"

### 5. Configurar Secrets (variables de entorno)

En tu servicio → Environment → Add Environment Variables:

```
WISPHUB_API_KEY = g1D2HhRY.lqRC3sGv4TosFEONheqBo4pvY8BfsTeZ
ACCESS_PIN = 1234
MIKROTIK_HOST = 154.88.128.161
MIKROTIK_PORT = 8728
MIKROTIK_USER = goku
MIKROTIK_PASS = MAXCELY6805
```

NO agregues:
- `DATABASE_URL` ya viene en render.yaml
- `NODE_ENV` ya viene en render.yaml
- `PORT` ya viene en render.yaml

### 6. Deploy

Render builda con tu Dockerfile y arranca. Te da una URL tipo:
`https://maxwifiapp.onrender.com`

### 7. Verificar

Abre la URL:
- `/health` → status del sistema (DB, MikroTik, WhatsApp)
- `/login` → si configuraste ACCESS_PIN
- `/live` → bandwidth en tiempo real desde tu MikroTik via internet

## IPs de Render permitidas

Estas 3 IPs ya están whitelisteadas en tu MikroTik:

```
35.160.120.126
44.233.151.27
54.184.196.143
```

Si Render cambia sus IPs (raro pero pasa), actualiza `ALLOWED_IPS` en `.env` local y corre:

```bash
node scripts/setup-mikrotik-access.js --apply
```

## Plan gratis vs pagado

**Free Tier ($0/mes):**
- 750 horas/mes (suficiente para 1 servicio 24/7)
- 100GB ancho de banda
- Disco persistente: 1GB (incluido)
- **Importante:** El servicio se duerme tras 15 min sin trafico
  - Primera carga después: ~30 segundos
  - Subsecuentes: rápidas

**Starter ($7/mes):**
- Sin sueño automático (always on)
- Recomendado para producción real

## Troubleshooting

### App no conecta al MikroTik
1. Verifica port forward en Mercusys: `curl http://154.88.128.161:8728/`
2. Verifica IPs Render whitelisteadas en MikroTik:
   ```bash
   node scripts/check-firewall.js
   ```
3. Revisa logs en Render dashboard

### App lenta primera vez
Es el wake-up del free tier. Sube a Starter ($7/mes) para always-on.

### Backup de DB
1. En la app: Settings → Diagnóstico → Descargar backup
2. O via SSH desde Render Shell

## Mantenimiento

### Actualizar código
```bash
git push origin main
```
Render hace auto-deploy.

### Ver logs
Render dashboard → tu servicio → Logs

### Variables de entorno
Render dashboard → tu servicio → Environment
