# Verificacion en MuMu 3

Fecha: 2026-09-04. Instancia confirmada mediante mumu-cli: indice 3,
nombre `jcsnicker`, Android 15/API 35, ADB 127.0.0.1:16480, 540x960/240 dpi.

## APK firmada

- Instalacion correcta de ISP Max 0.1.0-preview, paquete com.ispmax.mobile.
- Apertura en frio: Activity iniciada correctamente, 894 ms reportados por Android.
- SHA-256 sin cambios: 80337D8CFF6D7148381565BA9E67108CFC55C33D5885CE8F920DB4C0EAE5B495.
- Pantalla de acceso visible, campos y controles sin superposiciones.
- Railway `/mobile/v1/version` devuelve HTTP 200 con HTML de Angular, no JSON movil.
  La API nativa sigue pendiente de despliegue; no se certifica login productivo.

## Recorrido aislado

La misma interfaz se compilo como ISP Max QA, paquete distinto `.qa`, contra
SQLite desechable. No se usaron credenciales ni clientes reales.

- 3 pruebas instrumentadas aprobadas: almacenamiento, recorrido UI y sesiones.
- Login QA, resumen, busqueda por IP, expediente, recreacion de Activity,
  conservar filtro al regresar, cartera, factura, nota, PON, ONU y logout.
- Cifrado/restauracion de sesion, cache ante 503, rechazo ante 403/401 y revocacion.
- Factura comprobada visualmente con captura real de pantalla: importes y fechas visibles.
- No se certifico impresion externa en MuMu: el servicio UiAutomation estaba ocupado.
- El primer intento de instrumentacion fallo por ese servicio ocupado, no por
  una accion de negocio. Se adapto la captura del test sin detener otros procesos.
- Capturar el visor con Compose produjo una imagen blanca; `screencap` confirmo
  que el documento si se renderiza. No confundir ese artefacto con un visor vacio.

## Evidencia y limpieza

- `output/mumu3-qa/release-login.png`: APK firmada abierta.
- `output/mumu3-qa/screens`: pantallas del recorrido de prueba.
- `output/mumu3-qa/document-screen.png`: factura real renderizada en MuMu.
- Se conserva la APK firmada y la instancia 3 abierta. La variante QA y su runner
  se retiran al terminar; el servidor de fixtures se detiene.
- Sin cambios en los otros emuladores, Railway, WispHub, MikroTik u OLT.
