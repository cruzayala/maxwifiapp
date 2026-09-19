# ONU Studio | ISP Max

Aplicacion Windows para detectar y administrar Huawei/Novatech EG8141A5 y ZTE F670L desde una PC conectada por Ethernet.

## Ejecutable portable

Ejecuta `build-onu-studio.ps1` para producir `release/ONU-Studio-ISP-Max.exe`.
El archivo incluye Python, la interfaz y Chromium; la PC de destino no necesita instalarlos.
Al abrirlo, Windows solicita permisos de administrador y muestra la interfaz en una ventana propia.

Los datos persistentes se guardan en `%LOCALAPPDATA%\ISP Max\ONU Studio`:

- `provisioner.db`: historial SQLite.
- `backups/`: respaldos de las ONU.
- `logs/onu-studio.log`: diagnostico del programa.
- `.env`: configuracion tecnica opcional.

## Inicio

1. Ejecuta `instalar-onu-provisioner.ps1` una sola vez.
2. Ejecuta `iniciar-onu-provisioner.ps1` como administrador.
3. Abre `http://127.0.0.1:8765` o el modulo **Configurar ONU** de ISP Max.

El agente solo escucha en `127.0.0.1`. La clave tecnica vive en `.env`, archivo ignorado por Git. Los respaldos y el historial SQLite se guardan en `data/`.

## Flujo

- Presenta un asistente de cinco pasos: detectar, cliente e IP, Internet, WiFi y revision.
- Coordina con ISP Max en Railway para reservar una IP disponible y preparar WispHub/MikroTik antes de modificar la ONU.
- Deriva automaticamente mascara, gateway y origen remoto del segmento reservado.
- Genera un SSID basado en el cliente y una clave WiFi segura, ambos editables.
- Agrega una IP secundaria a la tarjeta Ethernet sin modificar WiFi.
- Detecta la ZTE F670L por IPv6 link-local cuando su IPv4 de fabrica entra en conflicto con la red WiFi de la PC.
- Lee el inventario completo y aprovisiona la F670L V7.1: WAN estatica, VLAN, enlace de puertos, WiFi dual WPA2-AES, TR-069, NTP y acceso HTTP restringido. Cada cambio usa respaldo y lectura posterior; las claves nunca se incluyen en el expediente.
- Vincula cada modelo con un controlador independiente para impedir que selectores Huawei se ejecuten sobre una ZTE.
- Comprueba modelo y credenciales, y lee el serial GPON real en ambos formatos.
- Muestra hardware, firmware, MAC, estado OLT, CPU/RAM, optica, WAN, LAN, WiFi y acceso remoto directamente desde la ONU.
- Sincroniza en SQLite de ISP Max una lectura antes y otra despues de configurar, enlazada por el serial real para que el modulo OLT use el mismo inventario.
- Mantiene separados los valores actuales de la ONU y el perfil nuevo; solo los copia al formulario por accion del operador.
- No lee ni devuelve claves guardadas de GPON, WAN o WiFi.
- Descarga un respaldo previo cuando el firmware lo permite.
- Configura IPoE Router, VLAN, IP estatica, NAT, DNS y enlaces LAN/SSID1.
- Crea la WAN como `TR069_INTERNET`, configura el ACS, autenticacion y reporte periodico cuando TR-069 esta activo.
- Mantiene las claves ACS y de solicitud de conexion en `.env`; la API solo informa si estan disponibles.
- Configura WPA2-PSK/AES y desactiva WPS.
- Habilita solamente HTTP WAN y lo restringe al CIDR indicado.
- Guarda sin reiniciar, verifica y descarga respaldo final.
