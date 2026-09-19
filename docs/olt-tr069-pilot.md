# Piloto OMCI y TR-069

Fecha de prueba: 2026-08-09

## Equipo probado

- OLT: ZTE C320, software V2.1.0.
- ONU: Huawei EG8141A5, firmware V5R019C00S050.
- Interfaz OLT: `gpon-onu_1/1/13:5`.
- Serial: `HWTC9EC8CEAF`.
- VLAN de servicio: `101`.

## Resultado OMCI

La OLT puede leer inventario, estado PON, potencia optica, puertos Ethernet,
capacidades basicas de WiFi, IP-host, T-CONT y GEM. El soporte de escritura es
parcial por tratarse de una OLT ZTE con una ONU Huawei. Los intentos de escritura
WiFi devuelven `unknown ME`, por lo que esos cambios no deben ofrecerse como
operaciones OMCI disponibles para este modelo.

## Resultado TR-069

Se levanto un ACS GenieACS aislado en Railway con autenticacion HTTP Basic y NBI
privada. La URL se aplico a la ONU por OMCI, primero por HTTPS y luego por HTTP
directo mediante un proxy TCP. Tambien se probo el canal de gestion sin etiqueta
y con VLAN 101. La ONU no envio ningun `Inform` al ACS.

La causa comprobada es que el perfil WAN local se encuentra definido con lista de
servicios `INTERNET`. En este firmware Huawei, la WAN usada por CWMP debe incluir
`TR069`, normalmente como `TR069_INTERNET`. La entidad TR-069 de la OLT acepta la
configuracion, pero no modifica la lista de servicios del perfil WAN Huawei.

Al finalizar el piloto se restauro la ONU a su estado original:

- TR-069 bloqueado.
- ACS vacio.
- Trafico de gestion sin etiqueta.
- Sin cambios en WAN, WiFi, LAN, velocidad o servicio del cliente.

## Flujo de implementacion

1. ONU Studio detecta la ONU por LAN y crea un respaldo.
2. Conserva todos los valores del perfil WAN actual.
3. Cambia solamente `ServiceList` de `INTERNET` a `TR069_INTERNET`.
4. Configura ACS, usuario, clave y periodo de `Inform` desde el panel Huawei.
5. Reinicia la ONU y exige el primer `Inform` antes de marcar TR-069 como activo.
6. Descubre y guarda el arbol real de parametros del equipo.
7. Habilita cambios reversibles solo para parametros anunciados como escribibles.
8. Si falla el registro, restaura el respaldo y mantiene el control por agente local.

No se debe activar TR-069 masivamente hasta completar este flujo en una ONU de
laboratorio y validar reinicio, Internet, WiFi, acceso remoto y rollback.
