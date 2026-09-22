# ISP Max Android 0.3.0-preview

## Alcance

Gestion de equipos individuales desde Inventario y Clientes > Equipos > Gestionar equipos. Registrar, editar, buscar por serial/MAC/marca/modelo, filtrar estado, asignar desde stock, devolver, eliminar y consultar los ultimos 50 movimientos. CSV de la pagina visible.

Tipos unitarios se seleccionan de los existentes en la web. Compras, CRUD de tipos y materiales por cantidad no estan portados. No se crean clientes ni se cambia MikroTik/OLT al asignar una unidad del inventario.

## Seguridad y persistencia

- API, formularios y permisos administrativos tipados. Tecnico, cobranza y consulta no pueden usar el CRUD administrativo.
- Idempotencia y auditoria en la misma transaccion SQLite. Version anterior obligatoria; conflictos web/Android requieren una lectura nueva.
- Borradores por usuario/servidor en Room; solicitud incierta conserva su clave. No se reintentan escrituras automaticamente.
- Proteccion de costo/origen de compras, seriales duplicados y equipos asignados. El historial y las facturas no se eliminan al devolver una unidad.
- Lecturas GET recuperan sockets reutilizados obsoletos mediante OkHttp, manteniendo el limite de tiempo de la llamada.
- Sin migraciones: hash Prisma local y remoto d8691c41308b86f8158080ef097e4871d29aae33e25858f04e576577c4523f5d.

## Pruebas

- 152 pruebas Node aprobadas, incluidas 18 de la API movil.
- 61 pruebas Python del agente Windows aprobadas con directorios temporales.
- 13 pruebas unitarias Android; builds debug/release aprobados. Lint debug inicial y lint vital release aprobados.
- 7 pruebas instrumentadas aprobadas en MuMu Android Device-1: telefono 540x960/densidad 240 y tableta 1280x800/densidad 160. No se modificaron otras instancias.
- Flujo de equipo probado: validacion, borrador/recreacion, alta, asignacion desde expediente, historial, devolucion, edicion, busqueda sin resultados y eliminacion. Prueba adicional con pausas de 15 segundos entre etapas aprobada.
- Simultaneidad de asignaciones, duplicados, permisos, compras vinculadas y conservacion de facturas cubiertos por API aislada.
- Capturas inspeccionadas en output/android-0.3-qa. El arnes inicial fallo al capturar ventanas anidadas y al conectar UiAutomation de MuMu; se elimino el anidamiento y se uso captura Compose/ADB, con aislamiento de sesion antes de cada actividad. La suite final pasa. No se atribuye ese fallo del arnes a una operacion de produccion.
- No se certifica impresion fisica ni configuracion ONU. No se uso informacion de produccion como fixture.

## Entrega

- APK 0.3.0-preview, versionCode 5, firma privada conservada. Instalacion sobre version anterior en Device-1 sin borrar datos; resolucion original restaurada.
- SHA256 1ec32d703e9ab2793d85318f09d713a06528b347ad7b8c29faf463b67e7359ab; 42757067 bytes.
- Servidor QA detenido y reverse ADB retirado.
- Respaldo consistente verificado: /data/backups/pre-android-0.3-2026-09-05T04-13-58-778Z.db, 187359232 bytes. 394 clientes, 9344 facturas, 0 equipos; quick_check=ok.
- Despliegue Proyectos / production / ISP max: 1ddbfa81-cd80-4a58-ad81-bfbb8b673130, SUCCESS. Health y version movil responden 200; equipos y descarga sin autenticar responden 401.
- Verificacion posterior: ocho rutas de equipos montadas, APK remoto con el mismo SHA256, SQLite quick_check=ok, 394 clientes, 9344 facturas y 0 equipos conservados. No se insertaron fixtures en produccion.
- Sincronizacion WispHub/MikroTik observada sin errores; OLT sincronizando a 60000 ms. Su inventario reporta 167/176 online y 7 alarmas, por lo que no se declara toda la infraestructura libre de incidencias.
- La descarga autenticada queda publicada en Configuracion. La instalacion y acciones se certificaron contra API aislada; no se probaron escrituras ni inicio de sesion de una cuenta real en produccion.
- Encuestas permanecen desactivadas. Las alertas de dependencias documentadas en android-0.2-qa.md no se resuelven con este hito.
