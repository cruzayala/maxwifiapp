# Integracion OLT ZTE C320

El modulo `/olt` administra el inventario operativo de la C320 sin depender de AdminOLT.
Las consultas son de solo lectura y la autorizacion de una ONU se ejecuta mediante una
operacion tipada y protegida; el navegador nunca puede enviar comandos CLI arbitrarios.

## Funciones disponibles

- Conexion directa por Telnet a la red privada/VPN de la OLT.
- Estado del chasis, firmware, uptime, tarjetas y temperaturas.
- Inventario de ONUs con PON, ID, modelo, serial y estado.
- Conteo online/offline por puerto PON.
- Alarmas activas con severidad, codigo y descripcion.
- Diagnostico bajo demanda: distancia, RX/TX y atenuacion de una ONU.
- Historial optico por ONU con retencion de hasta 500 mediciones.
- Conciliacion de seriales entre WispHub y el inventario de la OLT.
- Asociacion manual cliente-ONU protegida contra sobrescritura por el sync.
- Registro persistente de ONUs descubiertas que aun no estan autorizadas.
- Asistente guiado para autorizar una ONU descubierta y asignarla a un cliente de WispHub.
- Lectura en vivo de modelos, perfiles GPON e IDs disponibles antes de preparar el cambio.
- Vista previa de todos los pasos, confirmacion reforzada y verificacion posterior.
- Reversion automatica de la ONU si la configuracion o su verificacion falla.
- Bitacora de sincronizaciones y cambios de asociacion con usuario y fecha.
- Historico de snapshots en SQLite.
- Sincronizacion de estado cada minuto e inventario cada diez minutos.
- Acceso autenticado para roles tecnicos; sincronizacion manual solo para administradores.

## Configuracion

Las credenciales viven unicamente en variables del servidor. Nunca se envian al navegador.

```dotenv
OLT_ENABLED="true"
OLT_HOST="172.16.30.1"
OLT_PORT="23"
OLT_USER="usuario-lectura"
OLT_PASS="clave-segura"
OLT_SYNC_INTERVAL_MS="60000"
OLT_INVENTORY_INTERVAL_MS="600000"
```

Use una cuenta CLI dedicada de escritura solo cuando se habilite el asistente de autorizacion.
El servidor debe alcanzar la IP privada mediante LAN o VPN; no se recomienda publicar Telnet
en Internet. El acceso al asistente y a sus endpoints requiere el rol `admin`.

## Flujo de autorizacion

- No se exponen comandos CLI arbitrarios.
- La ONU debe continuar visible en la lista de equipos sin autorizar.
- Se exige seleccionar un cliente de WispHub con IP valida y sin otra ONU asociada.
- La IP debe pertenecer a `192.168.16.0/24`, coincidir con la IP de WispHub y no estar
  ocupada por otro cliente en el inventario local.
- El modelo y los perfiles deben existir realmente en la configuracion de la C320.
- El sistema reserva el primer ID libre del PON y prepara ONU, TCONT, GEM port,
  service-port, VLAN 101 e IP host.
- Antes de ejecutar se muestra una vista previa y se exige escribir `AUTORIZAR <SERIAL>`.
- Al finalizar se consulta nuevamente la OLT y se verifican serial, VLAN/service-port e IP.
- Si falla despues de crear la ONU, se ejecuta `no onu <ID>` y se guarda la configuracion.
- El resultado queda registrado en la bitacora con usuario, fecha, cliente y parametros.

El asistente no reinicia ni elimina ONUs existentes. La eliminacion manual, el cambio de
VLAN de una ONU activa y el reemplazo de serial permanecen deshabilitados.

## Asociacion y agente local

- La asociacion automatica ocurre cuando el serial de WispHub coincide; las asociaciones
  manuales tienen prioridad y no se eliminan durante sincronizaciones posteriores.
- Las lecturas opticas se consultan bajo demanda para no interrogar 166 ONUs cada minuto.
- Para modelos `EG8141A5`, el resultado ofrece continuar al agente local para completar WAN,
  WiFi y acceso remoto de la ONU. En otros modelos se completa solamente la parte OLT hasta
  que exista un adaptador local probado para ese firmware.
