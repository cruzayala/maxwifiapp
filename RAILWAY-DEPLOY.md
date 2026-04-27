# Deploy a Railway con acceso al MikroTik

## Arquitectura

```
[Tu navegador / celular]
        ↓ HTTPS
[Railway Cloud]
   - App Angular
   - Express + DB SQLite
   - WhatsApp (Baileys)
        ↓ RouterOS API (puerto 8728)
[Internet]
        ↓
[Mercusys MW301R] (port forward 8728 → 192.168.10.1)
        ↓
[MikroTik 192.168.10.1] (acepta solo IPs whitelisteadas)
```

## PASO 1: Configurar MikroTik

Abre Winbox o WebFig (`http://192.168.10.1`) y ejecuta en Terminal:

```routeros
# 1. Habilitar API en puerto 8728
/ip service set api disabled=no port=8728

# 2. Crear usuario dedicado para la app
/user add name=wishubapp password=PonUnaPasswordFuerte123 group=full

# 3. Verificar
/ip service print
```

## PASO 2: Port Forward en Mercusys

1. Abre `http://192.168.1.1` y haz login
2. Ve a **Advanced → NAT Forwarding → Virtual Servers**
3. Crea una regla:
   - Service Type: **Custom**
   - External Port: `8728`
   - Internal IP: `192.168.10.1`
   - Internal Port: `8728`
   - Protocol: **TCP**
4. Guardar

## PASO 3: Whitelist Railway en MikroTik

Desde tu PC (con la app):

```bash
cd "C:\Users\maxim\Desktop\wishubapp\wishub-admin"

# Edita el .env si cambias usuario/password
node scripts/whitelist-railway.js
```

Esto configura el MikroTik para aceptar API solo desde:
- Rangos de AWS US-East-1 (donde corre Railway)
- Tu IP publica actual

## PASO 4: Verificar acceso publico al MikroTik

Desde tu PC (probando como si fueras Railway):

```bash
# Test puerto 8728 desde IP publica
curl http://154.88.128.161:8728/  # Debe responder
```

## PASO 5: Deploy a Railway

### 5a. Crear servicio en Railway

1. Ve a https://railway.app/new
2. **Deploy from GitHub repo** → selecciona `cruzayala/maxwifiapp`
3. Railway detecta el Dockerfile y arranca el build

### 5b. Variables de entorno en Railway

En Settings → Variables, agrega:

```
WISPHUB_API_KEY = g1D2HhRY.lqRC3sGv4TosFEONheqBo4pvY8BfsTeZ
ACCESS_PIN = 1234
DATABASE_URL = file:/app/data/data.db
NODE_ENV = production

# MikroTik via IP publica
MIKROTIK_HOST = 154.88.128.161
MIKROTIK_PORT = 8728
MIKROTIK_USER = wishubapp
MIKROTIK_PASS = PonUnaPasswordFuerte123
```

### 5c. Volume persistente

1. En Railway → tu servicio → Settings → **Volumes**
2. Add Volume:
   - Mount Path: `/app/data`
   - Size: 1GB
3. Esto hace que `data.db` sobreviva redeploys

### 5d. Networking

1. Settings → Networking → **Generate Domain**
2. Te da una URL tipo `https://maxwifiapp.up.railway.app`

## PASO 6: Verificar deployment

Abre la URL de Railway. Deberias ver:
- App carga
- PIN de acceso (si lo configuraste)
- Health check: `https://maxwifiapp.up.railway.app/health`
- Pagina **EN VIVO** muestra clientes con bandwidth

## Mantenimiento

### Si Railway cambia de region/IP

Vuelve a correr:
```bash
node scripts/whitelist-railway.js
```

### Si tu IP publica cambia

Editar el script y volver a correr.

### Backup de la DB

```bash
# Desde Railway CLI
railway run cat /app/data/data.db > backup.db

# O desde la app: Settings → Diagnostico → Descargar backup
```

## Seguridad

- Usuario `wishubapp` solo via API, no SSH/Winbox
- Whitelist por rangos AWS limita el ataque surface
- PIN protege la app web
- HTTPS forzado por Railway
- Logs y auditoria en la DB

## Troubleshooting

**No conecta al MikroTik desde Railway:**
1. Verifica el port forward del Mercusys: `curl http://154.88.128.161:8728/`
2. Verifica whitelist: `/ip service print` en MikroTik
3. Logs Railway: `railway logs`

**App pero MikroTik desconectado:**
- En la app → Health check muestra `"mikrotik": "disconnected"`
- Solucion: actualizar whitelist con nueva IP de Railway
