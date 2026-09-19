# ISP Max Android 0.7.0-preview: entrega operativa verificada

## Alcance implementado

- Alta de clientes con WispHub, MikroTik, SQLite, IPAM en vivo y reserva atomica.
- Auditoria y estabilidad por cliente, historico WAN e inventario de direcciones IP.
- OLT en lectura: PON, ONU, pendientes, alarmas, diagnostico optico y capacidades sanitizadas.
- Mapa de clientes, estado de integraciones y sesiones moviles revocables.
- WhatsApp manual idempotente con historial, plantillas y conciliacion de resultados inciertos.
- Acciones de servicio por cliente: moroso, reactivar y bloqueo piloto segun permisos.

## Garantias

- SQLite se migra de forma aditiva y las sincronizaciones actualizan o agregan registros; no vacian el historial.
- Las escrituras moviles usan idempotencia, permisos explicitos y auditoria.
- Credenciales y secretos de infraestructura no se exponen en `/mobile/v1` ni se guardan en la cache publica de Android.
- Una respuesta HTTP no basta para declarar exitos externos cuando existe lectura posterior o conciliacion.

## Evidencia de entrega

- Servidor: 180 pruebas Node aprobadas y build Angular de produccion aprobado.
- Agente ONU: 70 pruebas Python aprobadas.
- Android: 17 pruebas unitarias aprobadas y APK debug/release compiladas.
- APK privada: 44,166,091 bytes, SHA-256 `8d48c64f06c73c9cfdd77394d044c71016d185cd833501c1192032532f441fdc`, firma v2 verificada.
- Railway: despliegue `feaf1d81-f20b-4f99-9050-2e1e5ab0212d` completado en `Proyectos / production / ISP max`.
- Respaldo consistente previo: `/data/backups/pre-android-0.7-20260915-114306.db` en el volumen Railway.
- Produccion: `/health`, sesion movil, resumen, clientes, facturas, red, auditoria, IPAM, OLT, sistema y WhatsApp respondieron correctamente; la sesion temporal fue revocada.
- Descarga: el APK servido por `/android-api/download` coincide con el hash del artefacto firmado.
- MuMu Android Device-1: el APK privado firmado se instalo como `com.ispmax.mobile`, inicio sesion y cargo el resumen real. El paquete QA recorrio Inicio, Clientes, Red, Cobros y Mas en 540x960; la composicion horizontal se reviso en 960x540.
- Flujos de lectura verificados: expediente con pestañas, cartera modal, facturas del cliente y diagrama PON/ONU con datos de produccion. No se ejecutaron mutaciones durante QA.
- Capturas: `android/app/build/reports/ispmax-0.7-release-home.png`, `ispmax-0.7-home.png`, `ispmax-0.7-clients.png`, `ispmax-0.7-client-detail.png`, `ispmax-0.7-wallet.png`, `ispmax-0.7-network.png`, `ispmax-0.7-olt.png`, `ispmax-0.7-billing.png`, `ispmax-0.7-more.png` e `ispmax-0.7-landscape.png`.

## Pendiente de certificacion fisica

- Prueba en telefono Android fisico y comprobacion de impresion con una impresora real.
- Operaciones directas MikroTik y autorizacion/configuracion OLT/ONU desde Android.
- Adaptadores locales EG8141A5 y F670L por WiFi o USB-Ethernet.
- Validacion de documentos en impresora Android y apertura de coordenadas en el proveedor de mapas instalado.

Esta version no muestra como disponibles las acciones de infraestructura que aun no han sido certificadas.
