# ISP Max Android 0.13.1 - evidencia

Fecha: 2026-09-15.

## Alcance

- APK release restringida al Railway real de ISP Max.
- Selector de servidor disponible solamente en debug/QA.
- Tickets oculto de la navegacion Android.
- Sin migraciones ni escrituras de datos de negocio durante esta verificacion.

## Compilacion y pruebas

- `:app:testDebugUnitTest`: aprobado.
- `:app:assembleDebug`: aprobado.
- `:app:assembleRelease` y `lintVitalRelease`: aprobados mediante `scripts/build-android-private.ps1`.
- Firma existente conservada: APK Signature Scheme v2, certificado `CN=ISP Max Android, O=ISP Max`.
- APK: `ISP-Max-Android-0.13.1-preview.apk`.
- Version: `0.13.1-preview`, codigo 16.
- Tamano: 44,641,329 bytes.
- SHA-256: `77d4a7d9a305ca9257a94d36ad0b97a61e9eed8b51ebc7be897cda990380254f`.

## MuMu Device-1

- Dispositivo: `127.0.0.1:16416`.
- Actualizacion con `adb install -r`: aprobada; sesion previa conservada.
- Inicio conectado al Railway real: aprobado.
- Resumen visible: 398 clientes, 343 activos y fuente SQLite.
- Tickets no aparece en la navegacion `Mas`.
- Proceso `com.ispmax.mobile` permanece activo, sin `FATAL EXCEPTION` ni errores de red de la aplicacion en el logcat posterior al inicio.

## Railway

- Proyecto: `Proyectos`.
- Entorno: `production`.
- Servicio: `ISP max`.
- Despliegue: `97815932-f1ad-4ae3-8a63-81852851a0c8`.
- Estado: `SUCCESS`.
- `/health`: `status=ok`, `database=connected`.
- Descarga autenticada: HTTP 200, nombre y SHA-256 coinciden con el manifiesto local.
- Lectura movil autenticada: 398 clientes, 9,370 facturas, `source=sqlite`.

## Persistencia

La base maestra sigue siendo SQLite en el volumen de Railway. Room no contiene fixtures de produccion ni sustituye esa base; conserva unicamente cache identificada, borradores, rangos locales y la sesion cifrada. Las mutaciones no usan la cache y requieren respuesta verificable del servidor.
