# ISP Max Android 0.8.0-preview: red operativa movil

## Alcance

- Monitoreo en vivo reutiliza el snapshot compartido de MikroTik; no abre una lectura adicional por telefono.
- Presenta presencia, transmision, consumo RX/TX, limites, diferencias y estado de cola por cliente.
- Permite buscar, filtrar, ordenar y paginar sin enviar credenciales ni campos privados al dispositivo.
- Resumen MikroTik presenta identidad, RouterOS, placa, uptime, CPU, memoria e interfaces desde las caches compartidas del servidor.
- Ambos contratos requieren rol tecnico o administrador y se anuncian mediante capacidades del servidor.
- Ante degradacion, el refresco retrocede de 5 a 15 segundos para En vivo y de 10 a 30 segundos para MikroTik.

## Evidencia local

- Contratos Node: 181 pruebas aprobadas, incluidas paginacion, filtros, orden, sanitizacion y permisos.
- Android: 18 pruebas aprobadas; compilacion `assembleDebug` y prueba de formato de tasas aprobadas.
- Python: las 70 pruebas del agente permanecen aprobadas sobre la misma base; esta entrega no modifica el agente.
- MuMu Android Device-1: pantallas En vivo y MikroTik verificadas contra el servidor QA aislado.
- Capturas: `android/app/build/reports/ispmax-0.8-qa-live.png` e `ispmax-0.8-qa-mikrotik.png`.

## Evidencia de produccion

- Respaldo SQLite atomico anterior al despliegue: `/data/backups/pre-android-0.8-20260915-121706.db` (185.9 MB).
- Railway `Proyectos / production / ISP max`: despliegue `71f9aeca-98e8-48a0-ab80-fef1a521fc02` finalizado en `SUCCESS`.
- `/health` respondio `ok` con SQLite conectado.
- La sesion movil temporal obtuvo capacidades `networkLive` y `mikrotikRead`; fue revocada al terminar la prueba.
- En vivo devolvio 402 clientes desde `mikrotik_shared_snapshot`; la verificacion en MuMu mostro 367 en linea, 35 sin presencia y 318.0 Mbps de consumo.
- MikroTik devolvio `connected: true`, CCR1036-12G-4S, RouterOS 7.9.2 y 29 interfaces desde `mikrotik_shared_cache`.
- La APK firmada instalada sobre MuMu Android Device-1 conservo la sesion y abrio ambas pantallas contra produccion.
- Capturas: `android/app/build/reports/ispmax-0.8-production-live.png` e `ispmax-0.8-production-mikrotik.png`.
- APK: `agent-downloads/ISP-Max-Android-0.8.0-preview.apk`, 44,231,627 bytes, SHA-256 `d8d8206e22c8c3eaf2201d110b34e43b976931fffdb863d364c7fadd4de6a120`.
- La descarga autenticada desde Railway coincide exactamente con el APK firmado local.

## Limites

- La pantalla movil observa; no cambia colas, interfaces, rutas, firewall ni DNS.
- Ping y operaciones administrativas requieren contratos tipados, confirmacion, auditoria y lectura posterior antes de habilitarse.
- La capacidad de lectura quedo verificada en produccion. Las escrituras MikroTik siguen bloqueadas hasta tener contratos tipados, idempotencia, auditoria y lectura posterior.
