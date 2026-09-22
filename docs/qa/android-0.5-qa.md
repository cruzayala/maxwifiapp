# ISP Max Android 0.5.0-preview: cobros en verificacion

## Implementado

- Solicitudes de pago en SQLite antes del POST a WispHub. Unicidad por usuario/clave y bloqueo por factura compartido entre web y Android.
- Consulta de saldo en vivo, catalogo real de formas de pago, importes en centavos para comparacion, fecha con zona horaria y version de la factura.
- Diferencia entre solicitud incierta, tarea pendiente, confirmacion externa, factura verificada y recibo local. HTTP 200/202 por si solos no implican pago aplicado.
- Ningun reinicio ni verificacion vuelve a ejecutar el POST de WispHub. Un intento no registrado se puede reenviar explicitamente con la misma clave.
- Ante error de SQLite posterior a confirmacion externa, se conserva el expediente y se recupera el recibo sin volver a cobrar.
- Formularios nativos, confirmacion visual, selector de fecha/hora, Room por usuario/servidor y recuperacion de solicitud.
- Solicitudes globales con busqueda, filtros, paginacion y consulta del estado desde otra sesion autorizada.
- Permisos de cobranza/administracion; tecnico y consulta no pueden cobrar ni leer solicitudes financieras.
- Modal web usa el mismo servicio y recupera la ultima operacion. Se bloquea el proxy legado de pagos para impedir saltarse la proteccion persistente.

## Pruebas verificadas

- 10 pruebas del motor de cobros: fechas/importes, reintento tras reinicio, respuesta perdida, tareas pendientes, lectura incompatible, rechazo, concurrencia de envio/verificacion y fallo de recibo SQLite.
- Suite Node completa: 167 pruebas aprobadas.
- Angular build aprobado. Persisten advertencias de bundle, estilos OLT y MapLibre ya existentes.
- 61 pruebas Python aprobadas con datos y recursos temporales.
- Android: 17 pruebas unitarias aprobadas; build debug e instrumentacion aprobados con versionCode 7. Lint final: 0 errores y 12 advertencias.
- Playwright sobre servidor QA aislado: pago de RD$50.25 aplicado a factura ficticia 9002; reabrir recupera la operacion confirmada. Se verifico tambien respuesta simulada 202: muestra pendiente y no ofrece registrar otra vez.
- Capturas inspeccionadas a 1280x720 y 390x844 en output/playwright/payment-desktop.png y payment-mobile.png. Tambien se guardaron payment-confirmed-mobile.png y payment-pending-mobile.png.
- Ningun cobro real ni escritura de infraestructura o produccion.

## Bloqueo MuMu Device-1

- Instancia 1 confirmada por MuMuManager: Android Device-1, Android 15, ADB 127.0.0.1:16416. No se modificaron otras instancias.
- Primer intento: SIGBUS al cargar DEX; hash de APK instalada distinto al compilado. La instalacion posterior devolvio EIO.
- Se reinicio solamente Device-1 y se reinstalo la APK QA mediante transferencia completa. El SHA256 instalado coincidio: 12a89c49413296e3c581b30ce3d5ed1644865c9cbe57ce64f96249abf2f92967 (compilacion intermedia, no candidata final).
- Siguiente prueba instrumentada fallo durante login con ausencia de jerarquia Compose. El registro muestra reinicios continuos de com.android.systemui por SecurityException: READ_CONTACTS denegado.
- Se solicito autorizacion para restaurar ese permiso del sistema. No se concedio ni se leyeron contactos. Certificacion de flujo Android pendiente; no se declara aprobada la suite de emulador.

## Entrega y restricciones

- VersionCode 7. Servidor, esquema y APK permanecen locales; no se desplego a Railway ni se sustituyo el APK publicado.
- Candidata final: `output/android-candidates/ISP-Max-Android-0.5.0-preview.apk`. Release y firma v2 verificados, misma clave RSA de versiones anteriores. SHA256: `693b63d1a543e7c5cf2a2944a3d7f0c6d3e112077f617506a2433fb381b14e85`.
- Servidor QA detenido y navegador de pruebas cerrado. No queda listener reverse 7415. Los fixtures y capturas se conservaron para revision.
- BillingOperation es una tabla nueva aditiva. La migracion se ejercito en SQLite QA temporal, no en la base de produccion. Exige respaldo consistente antes del despliegue.
- No se permiten sobrepagos ni se inventan formas de pago; la conciliacion incierta sin task_id requiere comprobacion externa y no tiene desbloqueo automatico.
- Confirmacion por saldo es una lectura compatible posterior, no un identificador de transaccion bancaria. No se modifican silenciosamente las facturas del espejo SQLite: su sincronizacion habitual debe actualizar los totales.
- La impresion fisica y un pago real controlado siguen pendientes. El documento compartido puede reflejar el ultimo espejo sincronizado.
- La matriz completa permanece en android-parity.md. Esta entrega no certifica clientes externos, operaciones OLT/MikroTik, configurador ONU nativo ni administracion completa.
