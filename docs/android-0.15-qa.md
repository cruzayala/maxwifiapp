# ISP Max Android 0.15.0: evidencia de cierre

Fecha: 22/09/2026

## Compilacion y pruebas

- Suite Node: 192 de 192 pruebas aprobadas (7 nuevas en `test/mobile-modules.test.js`).
- Android JVM: 28 de 28 pruebas aprobadas (3 nuevas en `CollectionToolsTest`).
- Build Angular, variante debug y release firmada: aprobados.

## APK privada

- Archivo: `ISP-Max-Android-0.15.0-preview.apk`, version `0.15.0-preview`, versionCode `18`.
- Tamano: 44,837,937 bytes. SHA-256: `7825f3343466541a1a21e9e84f22f44d1b9c05a47fcb8033b21936b0ecb98ead`.
- Firma verificada con `apksigner`, misma clave privada de actualizacion.

## Recorrido en emulador (AVD Vetlis_QA_API35, Android 15) contra el servidor QA aislado

- Cobros -> Cola de cobranza: RD$ 3,000.00 de 2 clientes; primero el activo con aviso, luego el suspendido.
- Cobrar abre la factura mas antigua (#9003) con saldo verificado; se cerro sin registrar el pago.
- Expediente: Llamar abre el marcador sin llamar; Probar enlace devuelve cola, trafico, ping, ARP y veredicto.
- Planes: precio de la mayoria, planes por revisar y "Ver clientes de este plan" con la lista filtrada.
- Encuestas: 50 % de respuesta; la pausa global pide confirmacion y la pantalla refleja la confirmacion del servidor.
- Tickets visible nuevamente; bot con busqueda, salto al expediente y "Seguir en WhatsApp".
- APK release instalada y abierta sin `FATAL EXCEPTION`, fijada al servidor de Railway.

## Limites que se mantienen

- Operaciones OLT/ONU destructivas y configuracion de ONU desde Android siguen bloqueadas hasta certificarlas con equipos reales.
- Edicion de limites de velocidad en MikroTik y envio de encuestas nuevas siguen solo en la web.
- En el servidor QA no hay acciones de aviso/corte configuradas; ese boton se oculta alli y se muestra donde el servidor lo anuncia.
