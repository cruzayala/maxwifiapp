# ISP Max Android: verificacion del hito inicial

Fecha: 2026-09-04. Version: 0.1.0-preview. No es una entrega de paridad completa.

## Entorno aislado

- API Express con SQLite nueva en TEMP, sin cargar server.js ni sincronizadores.
- Usuarios/clientes/ONU ficticios. Ninguna configuracion de infraestructura real.
- Emulador Android 15, API 35, dedicado a QA de ISP Max.
- Telefono 1080x2400 / 420 dpi; compacto 720x1280 / 320 dpi, fuente 130%;
  tableta 1920x1200 / 240 dpi. Estos son perfiles emulados, no hardware certificado.
- Regresion Python con ONU_DATA_DIR y ONU_RESOURCE_DIR temporales; sin abrir
  el almacenamiento del agente instalado.

## Pruebas aprobadas

- Node: 145 pruebas, incluidas 14 de API movil/documentos.
- Python del agente Windows: 61 pruebas, sin cambios en sus controladores.
- Android: 7 pruebas unitarias de URL y reconocimiento de modelos.
- Android instrumentado: 3 pruebas, repetidas en los tres perfiles de pantalla.
- Recorrido: login, resumen, busqueda, expediente, recreacion de Activity,
  regreso conservando filtro, cartera, documento, apertura del Print Spooler,
  nota guardada, PON, ONU y cierre de sesion.
- Persistencia: upsert SQLite, aislamiento por usuario/servidor, borradores;
  sesion cifrada y restaurada, copia local ante 503, sin acceso por cache
  ante 403/401, borrado de credencial al confirmar revocacion.
- Web Angular: build aprobado. Generador de documentos compartido verificado.
- Android: assembleDebug, assembleDebugAndroidTest, testDebugUnitTest y lintDebug.
- APK release: compilada, firma v2 verificada, instalada y abierta en el emulador.
  SHA-256: `80337D8CFF6D7148381565BA9E67108CFC55C33D5885CE8F920DB4C0EAE5B495`.
- Buffer de crashes del emulador sin errores durante el recorrido.

## Correcciones encontradas durante QA

- Ocultar teclado al iniciar sesion/navegar y conservar filtros/posicion.
- Cierre explicito de cartera y formularios con pestañas desplazables.
- Acciones del documento colocadas antes del visor: siempre alcanzables.
- Fechas YYYY-MM-DD sin desplazamiento de dia; pruebas UTC, Santo Domingo y Los Angeles.
- Revocacion confirmada elimina la sesion cifrada, no permite restaurarla offline.
- Esquema Room v1 exportado, sin migraciones destructivas.
- Exclusiones de backup/transferencia de datos en Android 12+ ademas de allowBackup=false,
  segun [documentacion Android](https://developer.android.com/identity/data/autobackup).

## Evidencia local

- `output/android-qa/qa`: capturas del telefono.
- `output/android-qa-small`: capturas compactas con fuente ampliada.
- `output/android-qa-small-final`: recorrido de la compilacion final con fuente 130%.
- `output/android-qa-tablet`: capturas de tableta.
- `android/app/build/reports`: pruebas unitarias y lint.
- `android/app/schemas`: esquema SQLite inicial versionado.
- `output/android-release/ISP-Max-Android-0.1.0-preview.apk`: APK privada preliminar.

## No verificado / pendiente

- No se ha desplegado `/mobile/v1` a Railway ni migrado su SQLite de produccion.
- APK privada preliminar, firma fuera del repositorio; descarga integrada en la web pendiente.
- Falta la paridad de acciones descrita en `android-parity.md`: altas/pagos,
  IPAM, monitoreo en vivo, operaciones OLT/OMCI/TR-069 y CRUD administrativos.
- Configurador local Android: solo sondeo de pagina HTTP; no autentica ni configura ONU.
- No se certificaron EG8141A5/F670L con telefono real, WiFi, USB-Ethernet ni Router/Bridge.
- Apertura de impresion/PDF probada; impresoras fisicas y guardado/comparticion con
  cada proveedor Android no certificados.
- Advertencias de build: dependencias Android mas nuevas disponibles, kapt,
  y presupuestos de bundle/CSS y CommonJS existentes en Angular. No son errores de build.
- Las encuestas y la infraestructura de produccion no fueron modificadas.
