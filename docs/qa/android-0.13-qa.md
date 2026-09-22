# ISP Max Android 0.13.0-preview: IPAM local y tickets WispHub

## Alcance

- Administra hasta 16 rangos IP locales en Room sin guardar esta configuracion como rango global de Railway.
- Valida CIDR, solapamientos, VLAN, gateway, DNS, intervalo utilizable, exclusiones y un maximo combinado de 65,536 direcciones activas.
- Usa todos los rangos activos al consultar disponibilidad y reserva atomicamente la IP elegida antes del alta.
- Crea, edita y cierra tickets en WispHub desde una pantalla Compose nativa.
- Conserva el intento del ticket en Room y reutiliza la misma clave ante una respuesta incierta.
- Relee WispHub y rechaza la operacion si cualquier campo solicitado no coincide.

## Evidencia aislada y de entrega

- Regresion del servidor: 184 pruebas aprobadas.
- Android: 25 pruebas unitarias y 10 pruebas instrumentadas aprobadas; compilaciones debug, androidTest y release, migracion Room 1 a 2 y `lintVitalRelease` aprobados.
- MuMu Android Device-1: rango inicial `192.168.16.0/24` visible y aplicado al asistente de cliente.
- La exclusion `192.168.16.1` no aparecio entre las direcciones seleccionables; `192.168.16.10` se reservo con confirmacion del backend QA.
- La APK creo el ticket QA `#900001`, mostro su descripcion sin HTML y lo cambio de `Nuevo` a `Cerrado` mediante lectura posterior.
- El recorrido completo en MuMu comprobo sesion, roles, clientes, facturas, pago idempotente, promesas, inventario, OLT, tickets y persistencia local en una sola ejecucion de 10/10 pruebas.
- Se corrigio el `keep-alive` HTTP de Node para impedir que una escritura movil deliberadamente no reintentable use una conexion cerrada mientras el tecnico revisa el formulario. El pago que reproducia el fallo paso despues del cambio y no se duplico.
- Ninguna de estas operaciones uso WispHub, MikroTik u OLT de produccion.

## APK y Railway

- APK privada: `ISP-Max-Android-0.13.0-preview.apk`, versionCode 15, 44,641,329 bytes.
- SHA-256: `db158cf49866918d37ff2b2b1528844fd763a225a6a05b90a90a9f74601b566d`.
- Firma APK v2 valida; certificado `CN=ISP Max Android, O=ISP Max` y la misma clave de actualizacion de versiones anteriores.
- Instalacion `-r` sobre 0.12 en MuMu aprobada: conservo sesion, Room y preferencias, y abrio el resumen real de produccion.
- Railway `Proyectos / production / ISP max`: despliegue `0bca40bb-75c8-4961-81df-58d7adc39556` en `SUCCESS`.
- `/health` respondio `200`, base conectada y MikroTik conectado. El arranque confirmo SQLite en `/data/data.db`, esquema actualizado sin borrado, sincronizacion WispHub/MikroTik sin errores y sincronizacion OLT activa.
- La descarga autenticada de produccion respondio `200`, MIME de APK, 44,641,329 bytes y el mismo SHA-256 del artefacto firmado.

## Seguridad y limites

- Solo administracion puede configurar rangos locales; tecnicos pueden operar tickets cuando el servidor anuncia `ticketWrite`.
- Los tickets requieren tecnico observado en los datos sincronizados y un cliente existente.
- La prueba de produccion fue solo de lectura; no se modifico ningun ticket, cliente, pago ni equipo real.
- Las escrituras OLT/ONU y los cambios MikroTik no certificados permanecen bloqueados.
