# ISP Max Android 0.2.0: verificacion incremental

## Entorno

- MuMu Android Device-1, indice 1, ADB 127.0.0.1:16416, Android 15.
- Telefono 540x960/densidad 240; prueba adicional 1280x800/densidad 160, restaurada al terminar.
- API aislada en 127.0.0.1:7415 con SQLite temporal. Nunca usa server.js ni sincronizadores de produccion.
- APK QA separada: com.ispmax.mobile.qa. APK firmada: com.ispmax.mobile.

## Pruebas

- Servidor: 149 pruebas aprobadas, incluidas 15 de API movil.
- Agente Windows: 61 pruebas Python aprobadas con directorios de datos/recursos temporales.
- Android: 10 pruebas unitarias aprobadas de URL, identidad ONU, presentacion y formulario de gastos.
- Cinco pruebas instrumentadas pasan en telefono y formato tableta: Room, sesiones cifradas, flujos operativos, roles y administracion de gastos.
- Gastos: validacion, creacion, borrador al cerrar/girar, busqueda de cliente, edicion, eliminacion y auditoria. API cubre repeticion idempotente, conflicto con edicion web, categorias, fechas e importes invalidos y gastos vinculados.
- Roles: tecnico sin cobros, cobranza sin red, viewer sin notas editables ni administracion.
- UI: capturas locales en output/android-0.2-qa; verificacion de cartera, PON, filtros, estados vacios, catalogos, gastos y sesiones.
- Build Angular aprobado. Persisten advertencias previas de tamano de bundle, CSS OLT y maplibre CommonJS.

## Railway

- Destino confirmado: Proyectos / production / ISP max.
- SQLite original: quick_check=ok. Respaldo consistente: /data/backups/pre-android-2026-09-05T03-29-51-116Z.db.
- Respaldo verificado: 394 clientes, 9344 facturas y 177 ONU; 187310080 bytes.
- Diferencia de esquema revisada: solo creacion de MobileSession/MobileMutation y sus indices.
- SURVEY_REMINDERS_ENABLED=false, sin modificar credenciales de infraestructura.
- Despliegue eec9d4cf-8d94-42e6-9d75-fec7d6309333: SUCCESS, 2026-09-05 UTC.
- Verificacion posterior: /health y /mobile/v1/version devuelven 200; gastos y descarga sin autenticar devuelven 401.
- SQLite quick_check=ok; conserva 394 clientes y 9344 facturas. Tablas MobileSession/MobileMutation presentes.
- Sincronizaciones de un minuto observadas entre 03:43 y 03:47 UTC: WispHub/MikroTik sin errores y OLT sincronizando. OLT informa 168/176 online y 6 alarmas; esto no certifica que toda la infraestructura este libre de incidencias.
- APK publicada e instalada: 0.2.0-preview, versionCode 3, 42593223 bytes; SHA256 737f90f14dcc8d8f1376ff181469135e4e5c80ef88cea59faa2ffd20bf296d3d, igual en PC y Railway.
- Firma conservada. Device-1 queda con resolucion original y APK firmada abierta en login. Servidor QA detenido y reverse ADB retirado.

## Limites

- MuMu no expone Print Spooler; la impresion externa sigue sin certificarse en esta instancia.
- El emulador no certifica WiFi/USB-Ethernet ni operaciones reales sobre ONU.
- No se ejecutan altas, cobros ni cambios de red en produccion para probar la APK.
- Operaciones de clientes/cobros, red, OLT y configuracion ONU siguen pendientes segun android-parity.md.
- Inicio de sesion con cuenta real y descarga desde el boton web aun no probados interactivamente; autenticacion y flujos se probaron con cuentas aisladas.
- npm audit --omit=dev reporta 17 avisos preexistentes de dependencias: 1 critico, 14 altos, 1 moderado y 1 bajo. El critico corresponde a @whiskeysockets/baileys. No se ejecuta audit fix ni se actualizan dependencias sin regresion; requieren seguimiento separado. La clasificacion no demuestra explotacion del despliegue.
