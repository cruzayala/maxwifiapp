# ISP Max Android 0.9.0-preview: diagnostico MikroTik

## Alcance

- Agrega ping tipado desde MikroTik a una direccion IPv4 o IPv6.
- Limita cada solicitud a entre uno y cinco paquetes y no expone comandos RouterOS arbitrarios.
- Verifica direccion, cantidad enviada y respuesta antes de presentar el resultado.
- Registra usuario, destino, paquetes recibidos y perdida en la auditoria SQLite.
- Mantiene todas las escrituras de interfaces, colas, rutas, firewall y DNS bloqueadas.
- Corrige el retroceso adaptativo de En vivo y MikroTik para usar el error mas reciente.

## Evidencia

- Regresion del servidor: 182 pruebas aprobadas.
- Android: 18 pruebas aprobadas; `assembleDebug`, `assembleRelease`, lint vital y firma v2 aprobados.
- Railway `Proyectos / production / ISP max`: despliegue `9d20b65c-49e1-4d36-aa43-92fcd22b0f8a` finalizado en `SUCCESS`.
- `/health` respondio `ok` con SQLite conectado.
- Prueba API real a `8.8.8.8`: 4/4 respuestas, 0% de perdida, resultado verificado desde `mikrotik_live`; la sesion temporal fue revocada.
- MuMu Android Device-1: APK firmada instalada, inicio de sesion real y ping ejecutado desde la pantalla MikroTik.
- Captura: `android/app/build/reports/ispmax-0.9-production-mikrotik-ping.png`.
- APK: `agent-downloads/ISP-Max-Android-0.9.0-preview.apk`, 44,248,011 bytes, SHA-256 `806e0abee2151a6e34e22d82c794531ec6a6b2ebc05413c3da53c9ef4a7b68d0`.
- Se conserva como respaldo previo compatible `/data/backups/pre-android-0.8-20260915-121706.db`; 0.9 no modifica el esquema de datos.

## Limites

- Ping es un diagnostico puntual, no una prueba de velocidad ni una modificacion de red.
- No se habilitan operaciones destructivas ni cambios de configuracion MikroTik desde Android.
- Las pruebas de ONU por WiFi o USB-Ethernet siguen requiriendo hardware recuperable y certificacion por firmware.
