# ISP Max Android 0.10.0-preview: ubicacion GPS de clientes

## Alcance

- Captura la ubicacion actual del tecnico con permisos Android de ubicacion precisa o aproximada.
- Permite introducir latitud, longitud y precision manualmente cuando el proveedor del dispositivo no esta disponible.
- Valida limites geograficos y exige una clave idempotente antes de guardar.
- Persiste coordenadas, precision, fecha y usuario en SQLite sin modificar la ficha externa de WispHub.
- Actualiza el expediente y el mapa despues de una escritura confirmada.

## Evidencia

- Regresion del servidor: 182 pruebas aprobadas.
- Android: 18 pruebas aprobadas; `assembleDebug`, `assembleRelease`, lint vital y firma v2 aprobados.
- Railway `Proyectos / production / ISP max`: despliegue `3e10001a-8c50-488a-b2b0-cb5fee88d6d2` finalizado en `SUCCESS`.
- `/health` respondio `ok`, con SQLite y MikroTik conectados.
- `/mobile/v1/me` anuncio `gpsWrite=true` para super_admin; la sesion temporal de QA fue revocada.
- MuMu Android Device-1: APK de produccion instalada como versionCode 12 y dialogo GPS abierto sin modificar datos reales.
- Captura: `android/app/build/reports/ispmax-0.10-production-gps-dialog.png`.
- APK archivada localmente: `output/android-release/ISP-Max-Android-0.10.0-preview.apk`, 44,280,823 bytes, SHA-256 `c6a8d7c7bb3884199149930a7c206bb2c6b85f26d48067d94a937d78483239d7`.
- La descarga autenticada de produccion devolvio la misma huella SHA-256.

## Limites

- No se guardaron coordenadas de clientes de produccion durante QA.
- La captura fisica requiere proveedor GPS o de red y permiso concedido; el emulador solo certifica permisos, formulario y navegacion.
- La ubicacion no se sincroniza a WispHub porque no existe un contrato externo certificado para ese dato.
