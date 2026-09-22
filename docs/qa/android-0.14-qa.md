# ISP Max Android 0.14.0: evidencia de cierre

Fecha: 15/09/2026

## Compilacion y pruebas

- Suite Node: 185 de 185 pruebas aprobadas.
- Android JVM: 25 de 25 pruebas aprobadas.
- Android debug y release: compilacion aprobada.
- `lintVitalRelease`: aprobado.
- Build Angular y comprobacion portable: aprobados.
- Advertencias web conocidas: presupuesto del bundle inicial, 502 bytes de estilo OLT y dependencia CommonJS de MapLibre. No bloquearon el despliegue.

## APK privada

- Archivo: `ISP-Max-Android-0.14.0-preview.apk`.
- Version: `0.14.0-preview`.
- Version code: `17`.
- Tamano: `44,657,713` bytes.
- SHA-256: `3d648b15c8c8eaf9124004dc697fed79550e7b26c666dd368820f10adb9c3659`.
- Firma APK v2 validada con la misma identidad de actualizacion.
- Descarga autenticada de produccion: HTTP 200, nombre y tamano coincidentes con el manifiesto.

## Railway y SQLite real

- Proyecto: `Proyectos`.
- Entorno: `production`.
- Servicio: `ISP max`.
- Despliegue: `f3275d20-7231-4378-9c24-46842a8da0fd`.
- Estado final: `SUCCESS`.
- `/health`: servicio correcto y base de datos conectada.
- Lectura movil autenticada: 398 clientes, 343 activos, 9,370 facturas y 180 ONU, con `source=sqlite`.
- Exportacion de clientes activos: 343 elementos de 343, con `source=sqlite`.
- Exportacion de facturas pendientes: 3 elementos de 3, con `source=sqlite`.
- Las sesiones temporales usadas en la verificacion fueron revocadas al terminar.

## MuMu Android Device-1

- Destino ADB: `127.0.0.1:16416`.
- Instalacion incremental sobre la version anterior: aprobada.
- Version instalada: `0.14.0-preview`, `versionCode=17`.
- Proceso iniciado correctamente y sin `FATAL EXCEPTION` en Logcat.
- La entrega release usa exclusivamente el servidor real de Railway; los servidores alternativos solo se permiten en debug/QA.

## Alcance de cierre

- Tickets permanece oculto por decision operativa.
- Clientes y facturas exportan el conjunto filtrado completo desde SQLite real.
- Operaciones destructivas OLT/ONU no certificadas permanecen bloqueadas y no simulan exito.
- Device Studio no forma parte de este objetivo.
