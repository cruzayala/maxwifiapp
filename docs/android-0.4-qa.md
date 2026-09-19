# ISP Max Android 0.4.0-preview: candidata local

## Alcance real

- Edicion de expediente local: nombre, telefono, documento y observaciones. No altera WispHub, MikroTik ni el servicio del cliente.
- Historial paginado dentro del expediente con proyeccion acotada; no expone JSON interno de auditoria.
- Promesas globales y por cliente: crear, editar, cumplir, incumplir, reabrir, buscar, filtrar vencidas y exportar la pagina. Una promesa cumplida no registra un pago.
- Borradores Room por usuario/servidor, reintentos con la misma clave y version. Las notas tambien mantienen bloqueado un intento incierto para no duplicarlo.
- Filtros de clientes por zona, plan y ausencia de IP; facturas por zona, forma de pago y fecha de emision/vencimiento/pago. Las fechas son inclusivas y validadas.
- KPI de facturas sobre todos los resultados, no solo la pagina.
- Reporte de facturacion por mes de emision: 3/6/12/24 meses, comparacion con periodo anterior, grafica y CSV de todas las filas del reporte. Cobrado corresponde a esas facturas, no al flujo de caja. Excluye Anulada.
- Capacidades anunciadas por servidor evitan mostrar las nuevas operaciones cuando la API antigua no las soporta.

## Pruebas

- 156 pruebas Node aprobadas; 22 corresponden a la API movil.
- 15 unitarias Android aprobadas. Compilaciones debug e instrumentacion aprobadas.
- Lint debug: 0 errores y 12 advertencias, antes de ajustes finales menores de presentacion/capacidades.
- Angular build aprobado con advertencias existentes de tamano de bundle/OLT y CommonJS de MapLibre.
- 61 pruebas Python del agente aprobadas con datos y recursos temporales. La primera ejecucion fallo porque el directorio static temporal no existia; se preparo y se repitio la suite completa.
- MuMu Device-1, 127.0.0.1:16416, telefono 540x960/densidad 240. No se modificaron otras instancias ni se instalo la candidata sobre la APK de produccion.
- La prueba nueva de expediente/promesas/filtros/reporte paso dentro de la suite. Dos ejecuciones iniciales del arnes fallaron por pestaña fuera del viewport y selector ambiguo de Cumplida; se corrigieron scroll y selector semantico especifico.
- La suite instrumentada completa ejecuto 8 pruebas: 4 aprobadas y 4 fallidas. Fallaron equipos, permisos, gastos y recorrido cliente/cartera. No se declara regresion aprobada.
- Evidencia de interferencia: ActivityTaskManager registra aperturas de Instagram por uid 2000 durante las pruebas (00:44:59 y 00:45:01 del 2026-09-05). Se solicito pausar esa automatizacion; no se detuvo ningun proceso ajeno. Se requiere repetir los fallos sin interferencia antes de atribuirlos o descartarlos como defectos de la APK.
- Capturas locales en output/android-0.4-qa/phone. Se inspeccionaron expediente, facturas y reporte. Se ajustaron columnas KPI y densidad del reporte despues de inspeccion; estos ultimos ajustes requieren nueva captura. Tableta y texto ampliado siguen pendientes en esta version.
- No se hicieron cobros, altas ni operaciones de infraestructura en produccion.

## Publicacion

- Candidata con versionCode 6, misma clave de firma privada fuera del repositorio.
- Release y lint vital aprobados. Firma APK v2 verificada; certificado SHA256 eec22881893ce65fabd3e6e43bb6a5dd27a8b1189cac35daf222c1d8ce8658b0, igual a 0.3.
- APK candidata: output/android-candidates/ISP-Max-Android-0.4.0-preview.apk; SHA256 d7f50b71f434e6c55e8789dfade1ee2c9dc99ed25a6a9ac3900a0a36d89dae71.
- build-android-private.ps1 -CandidateOnly genera en output/android-candidates sin reemplazar android-manifest.json ni la descarga publicada.
- No desplegada a Railway. Se conserva 0.3.0-preview publicada y instalada como APK de produccion.
- No hubo migracion ni borrado de SQLite. Las tablas actuales alojan expedientes, promesas, auditoria y recibos idempotentes.
- Encuestas sin cambios; permanecen desactivadas.
- Servidor QA detenido y reverse ADB de puerto 7415 retirado. No se dejo otro servidor ni una prueba corriendo.
- Health Railway consultado al cierre: status ok, database connected y mikrotik connected; WhatsApp disconnected. No se desplegaron cambios ni se modificaron datos de produccion.

## Pendientes de la conversion completa

Este hito no completa la matriz. Siguen pendientes altas/edicion externas y servicio, cobros durables con conciliacion, compras/tipos/materiales/nomina/tickets operativos, red/IPAM/OLT con acciones, configurador ONU nativo certificado y los modulos administrativos restantes.

En particular, la ruta web actual de pagos solo tiene bloqueo en memoria. No se habilito cobro en Android hasta implementar operacion durable y conciliacion de respuestas inciertas. Tampoco se certifica ONU fisica ni impresion fisica mediante el emulador.
