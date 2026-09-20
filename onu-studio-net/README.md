# ONU Studio .NET | ISP Max

Aplicación de Windows para configurar las ONU de los clientes (Huawei/Novatech **EG8141A5**
y ZTE **F670L**) conectada en todo momento con ISP Max en Railway.

Reemplaza al agente anterior en Python + navegador embebido. Misma lógica de trabajo y
mismos archivos de datos; interfaz nativa, un solo ejecutable y ajustes sin editar archivos
a mano.

## Cómo se usa

1. Abre `ONU-Studio-ISP-Max-vX.Y.Z.exe` y acepta el permiso de administrador.
2. **Conectar** — enchufa el cable Ethernet a la ONU. El programa la busca solo, dice qué
   modelo es y, al pulsar *Leer la ONU*, muestra su serial, firmware y señal óptica.
3. **Cliente** — entra con tu usuario de ISP Max (queda recordado de forma segura), elige
   el cliente, la zona, el plan y la IP libre. Al pulsar *Reservar*, la IP queda apartada y
   el cliente se prepara en WispHub y MikroTik.
4. **Internet** — los datos ya vienen puestos desde la reserva; puedes ajustarlos.
5. **WiFi** — nombre y clave propuestos a partir del cliente; ambos editables.
6. **Revisar** — resumen completo. Solo al pulsar *Aprovisionar* se toca la ONU: respaldo,
   configuración, verificación y otro respaldo.

Al cerrar la ventana el agente sigue vivo junto al reloj de Windows, disponible para las
tareas que ISP Max le mande (detectar, comprobar, aprovisionar y tareas TR-069).

## Qué hace por dentro

- **Sin instalar nada más**: usa el Microsoft Edge que ya trae Windows para operar el
  panel de la ONU; solo descarga un navegador propio si la PC no tuviera ninguno.
- **Detección automática**: prueba las IP de fábrica y, cuando la ZTE trae una IPv4 en
  conflicto, la encuentra por IPv6 link-local usando un puente local.
- **Orden de seguridad**: primero la nube (IP reservada, cliente preparado) y después la
  ONU. Si la nube falla, no se toca el equipo.
- **Cada cambio se verifica**: se vuelve a leer la ONU y, si algo no coincide, se detiene
  (y en la ZTE se restaura el respaldo previo).
- **Sin claves a la vista**: las contraseñas técnicas se guardan cifradas con DPAPI del
  usuario de Windows y se borran de cualquier mensaje de error.
- **Siempre conectado**: dos trabajadores preguntan a Railway por trabajos y reportan el
  progreso en vivo.

## Carpetas

Los datos viven donde ya los dejaba el agente anterior, así que al actualizar no se pierde
nada:

```
%LOCALAPPDATA%\ISP Max\ONU Studio\
  provisioner.db        historial de trabajos
  backups\              respaldos de las ONU y capturas de diagnóstico
  logs\onu-studio.log   registro del programa
  cloud-session.dat     sesión con ISP Max (cifrada)
  agent-settings.dat    credenciales técnicas (cifradas)
  browsers\             navegador interno de automatización
```

## Compilar

```powershell
.\build.ps1
```

Necesita el SDK de .NET 8 o superior. El resultado queda en `release\`.

## Estructura del código

```
src/OnuStudio.Core     motor: modelos, red, detección, nube, ONU, ACS, trabajos
src/OnuStudio.App      interfaz WPF (asistente, equipo, historial, ajustes)
tests/OnuStudio.Tests  pruebas del motor y de las reglas de la interfaz
```
