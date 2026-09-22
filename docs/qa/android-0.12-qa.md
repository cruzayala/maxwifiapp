# ISP Max Android 0.12.0-preview: edicion WispHub verificada

## Alcance

- Agrega edicion de datos personales y servicio desde el expediente Android.
- Consulta la version viva de WispHub al abrir y nuevamente antes de escribir.
- Solo envia campos modificados y rechaza una version obsoleta.
- Confirma por lectura posterior antes de actualizar el espejo SQLite o mostrar exito.
- Mantiene alias, notas y GPS locales como datos separados.
- Permite reemplazar la clave WiFi sin devolver la clave actual a Android.

## Evidencia local

- Regresion del servidor: 183 pruebas aprobadas.
- Android: 18 pruebas aprobadas; `assembleDebug`, `assembleRelease`, lint vital y firma v2 aprobados.
- MuMu Android Device-1: formularios Datos/Servicio abiertos contra el servidor QA aislado.
- Escritura UI aislada: IP cambiada a `192.0.2.21`; lectura posterior confirmo el mismo valor en proveedor simulado y SQLite.
- Caso negativo: una respuesta del proveedor que ignora el cambio devuelve HTTP 502 y no altera SQLite.
- Capturas: `android/app/build/reports/ispmax-0.12-qa-wisphub-profile.png` y `android/app/build/reports/ispmax-0.12-qa-wisphub-service.png`.
- APK: `agent-downloads/ISP-Max-Android-0.12.0-preview.apk`, 44,379,131 bytes, SHA-256 `8a759d14838f9367d24e0e47a1ff254888a1c0b6e110b4a76e59380eb489cf11`.

## Evidencia de produccion

- Railway `Proyectos / production / ISP max`: despliegue `08b8af74-87ab-440a-bcad-0a354c973fa8` finalizado en `SUCCESS`.
- `/health` respondio `ok`, con SQLite y MikroTik conectados.
- Tres sincronizaciones consecutivas informaron WispHub, facturas y MikroTik en estado `ok`, sin errores.
- MuMu Android Device-1 conserva la sesion cifrada tras actualizar a versionCode 14.
- El editor abrio la lectura real de WispHub para el cliente `#18`, sin ejecutar una escritura de produccion.
- Captura: `android/app/build/reports/ispmax-0.12-production-wisphub-read.png`.

## Seguridad

- Solo super_admin y admin pueden editar WispHub.
- La clave de operacion evita repetir una escritura tras perder la respuesta.
- El historial conserva actor, seccion y nombres de campos, nunca valores personales ni claves WiFi.
- El JSON publico solo informa si existe una clave WiFi.

## Limites

- La prueba UI modifica exclusivamente fixtures del servidor QA, no clientes reales.
- La lectura de produccion se verificara despues del despliegue sin ejecutar escrituras.
- Las operaciones OLT/ONU y MikroTik destructivas siguen bloqueadas hasta certificacion fisica.
