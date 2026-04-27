# Acceso remoto seguro a la app

La app corre localmente en tu PC pero el MikroTik está solo en tu red (192.168.10.1). Esto te da 3 opciones para acceder desde cualquier lado **sin exponer el MikroTik**:

## Opción 1: Cloudflare Tunnel (RECOMENDADA - gratis y segura)

Túnel SSL/TLS sin abrir puertos en tu router. URL pública estable.

```bash
# Instalar cloudflared
winget install Cloudflare.cloudflared

# Login
cloudflared tunnel login

# Crear túnel
cloudflared tunnel create maxwifiapp

# Configurar
echo "url: http://localhost:7400" > config.yml

# Correr el túnel
cloudflared tunnel run maxwifiapp
```

Te da URL tipo `https://maxwifiapp.tudominio.com` accesible desde cualquier lado.

**Pro:** Gratis, sin exponer puertos, SSL automático
**Contra:** Requiere dominio en Cloudflare

## Opción 2: Tailscale VPN (también gratis)

Crea una VPN privada entre tus dispositivos.

```bash
# Instalar Tailscale (https://tailscale.com)
# Login
tailscale up

# Tu PC obtiene una IP privada tipo 100.x.x.x
# Accedes desde otros dispositivos con esa IP:7400
```

**Pro:** Súper simple, gratis, NO necesita dominio
**Contra:** Requiere Tailscale instalado en cada dispositivo que quieras usar

## Opción 3: Port forward (NO recomendada)

Abrir puerto 7400 en tu router casero (Mercusys MW301R) hacia tu PC.

**Riesgo:** Tu PC queda expuesta a internet. Solo recomendado con:
- PIN configurado
- Firewall por IP (limitar quien puede acceder)
- HTTPS (no HTTP simple)

## Configuración de seguridad

Activa estas en `.env`:

```bash
# 1. Activa PIN
ACCESS_PIN="1234"

# 2. Solo permite tu IP publica (opcional)
ALLOWED_IPS="148.255.147.72,154.88.128.163"

# 3. NODE_ENV en produccion
NODE_ENV="production"
```

## Acceso desde celular/tablet

Una vez tengas la URL pública (Cloudflare o Tailscale), abre en cualquier navegador:
- iPhone/Android Safari/Chrome
- "Agregar a pantalla de inicio" → app instalable como PWA
- Funciona como app nativa
