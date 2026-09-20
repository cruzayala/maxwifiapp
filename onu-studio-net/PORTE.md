# Qué se portó del agente anterior

Mapa pieza por pieza entre el agente Python (`onu-provisioner/`) y esta aplicación .NET.
Sirve para comprobar que no quedó nada fuera.

## Motor

| Python | .NET | Notas |
|---|---|---|
| `provisioner/models.py` | `Core/Models/ProvisionModels.cs` | Mismas reglas de validación, con los mensajes en español del operador |
| `provisioner/identity.py` | `Core/GponSerial.cs` | Serial Huawei hexadecimal → formato de la OLT |
| `provisioner/paths.py` | `Core/AppPaths.cs` | Mismas carpetas: no se pierde historial ni respaldos |
| `provisioner/secure_store.py` | `Core/SecureJsonStore.cs` | DPAPI con la misma cabecera `DPAPI1\0` |
| `provisioner/storage.py` | `Core/Storage/JobStore.cs` | Mismo `provisioner.db` y mismas migraciones |
| `provisioner/network.py` | `Core/Net/NetworkTools.cs` | Adaptadores por API de Windows en vez de PowerShell; la IP se agrega igual |
| `provisioner/discovery.py` | `Core/Net/DiscoveryService.cs` | Mismas IP de fábrica y misma detección por IPv6 link-local |
| `provisioner/tcp_bridge.py` | `Core/Onu/LinkLocalHttpBridge.cs` | Puente a 127.0.0.1 para la ZTE por IPv6 |
| `provisioner/controllers.py` | `Core/Onu/IOnuController.cs` | Fábrica por modelo |
| `provisioner/huawei_eg8141a5.py` | `Core/Onu/HuaweiEg8141A5.cs` | Mismos selectores, mismo orden y mismas verificaciones |
| `provisioner/zte_f670l.py` | `Core/Onu/ZteF670L.cs` | Mismas páginas `.gch`, mismo firmware certificado y mismo rollback |
| `provisioner/genieacs.py` | `Core/Acs/GenieAcsClient.cs` | Todas las acciones TR-069, con lectura posterior y rollback |
| `provisioner/startup.py` | `Core/WindowsStartup.cs` | Misma tarea programada `ISP Max ONU Studio Agent` |
| `provisioner/installation.py` | — | Ya no hace falta: la app es un solo ejecutable |

## Servidor local → aplicación

El agente anterior levantaba un servidor web en `127.0.0.1:8765` y mostraba su interfaz
en un navegador. Ahora la ventana habla directamente con el motor.

| Endpoint anterior | Dónde está ahora |
|---|---|
| `GET /api/health` | Estado permanente en la barra lateral |
| `GET /api/discovery`, `POST /api/discovery/scan` | Paso 1 del asistente y botón «Buscar de nuevo» |
| `GET /api/defaults` | Valores iniciales del asistente |
| `GET/PUT /api/settings/network-ranges` | Ajustes → Rangos de IP |
| `GET/POST /api/startup` | Ajustes → «Abrir ONU Studio al iniciar Windows» |
| `GET /api/cloud/status`, `POST /api/cloud/login`, `POST /api/cloud/logout` | Paso 2 y Ajustes → Conexión con ISP Max |
| `GET /api/cloud/ip-catalog` | Paso 2 → IP libres |
| `GET /api/cloud/commercial-catalog` | Paso 2 → zonas y planes |
| `GET /api/cloud/clients` | Paso 2 → buscador de clientes |
| `POST /api/cloud/reservations` | Paso 2 → «Reservar la IP» |
| `POST /api/cloud/jobs` | Paso 2 → expediente en ISP Max |
| `POST /api/cloud/provision-client` | Paso 2 → crea el cliente en WispHub y MikroTik |
| `POST /api/check` | Paso 1 → «Leer la ONU» |
| `POST /api/provision` | Paso 5 → «Aprovisionar la ONU» |
| `GET /api/jobs/{id}` | Progreso en vivo del paso 5 |
| `GET /api/jobs/{id}/retry-template` | Historial → «Retomar este trabajo» |
| `GET /api/history` | Pantalla de Historial |
| `POST /api/maintenance/shutdown` | Icono junto al reloj → «Salir» |

## Conexión permanente con ISP Max

| Python | .NET |
|---|---|
| `OnuCloudTaskWorker` | `Core/Cloud/OnuCloudWorker.cs` — detectar, comprobar y aprovisionar desde la nube |
| `Tr069TaskWorker` | `Core/Cloud/Tr069Worker.cs` — tareas TR-069 y telemetría |
| `cloud_request`, `restore_cloud_session` | `Core/Cloud/CloudClient.cs` y `CloudSession.cs` |
| `run_check`, `run_provision`, checkpoints | `Core/Jobs/ProvisioningService.cs` |
| `JobManager` | `Core/Jobs/JobManager.cs` — mismos tramos de porcentaje por paso |

## Lo que cambió a propósito

- **Interfaz nativa** en vez de una página web local: no hace falta abrir el navegador
  ni recordar `127.0.0.1:8765`.
- **Ajustes con pantalla propia**: las credenciales técnicas y los rangos de IP ya no se
  editan en un archivo `.env`; se guardan cifradas con DPAPI. El `.env` anterior se lee
  una sola vez para no reconfigurar nada.
- **Dirección de ISP Max por defecto**: apunta a Railway, así que el técnico solo escribe
  su usuario y su contraseña.
- **Sin servidor local**: se elimina la superficie HTTP en la PC del técnico.
- **Navegador**: usa el Microsoft Edge que ya trae Windows, igual que la versión 1.13.
