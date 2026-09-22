# ISP Max Android: matriz de entrega

Estado actual: hito 0.16.0 (paridad con la web: OLT, MikroTik, TR-069, Configurar ONU, ajustes y resto de modulos). La paridad de consulta y administracion certificada esta disponible, mientras las operaciones de infraestructura marcadas como pendientes siguen bloqueadas.
Cada fila requiere pruebas de contrato, UI y dispositivo antes de marcarse completa.
El agente Windows y la web se conservan; los dispositivos de produccion no son fixtures.

| Web | Contrato existente | Paridad Android requerida | Estado |
| --- | --- | --- | --- |
| login | /auth, sesiones de dispositivo | Sesion movil separada, renovar, revocar, logout | API y Android implementados; inicio, renovacion y revocacion verificados contra produccion en MuMu Device-1; telefono fisico pendiente |
| dashboard | /db/stats, /network-audit | KPI con fecha/fuente, WAN, incidencias | Resumen SQLite, WAN, facturacion e incidencias implementados; En vivo queda disponible desde Red con snapshot compartido |
| clients | /db/clients, /api/clientes | Buscar, filtros, ordenar, paginar | Busqueda, estado, zona/plan exactos, sin IP y paginacion implementados; orden operativo aplicado por servidor |
| clients/new | /client-provisioning | Alta idempotente WispHub + MikroTik | Implementado con IPAM en vivo, reserva atomica y servicio compartido WispHub/MikroTik/SQLite; certificacion Android pendiente |
| clients/:id | /db, /clients-actions, /mobile/v1/clients/:id/external | Datos, cartera, notas, equipo, acciones, historial | Datos, servicio, cartera, notas, equipos, promesas, historial, acciones y edicion externa verificada en WispHub implementados; certificacion con una modificacion real controlada pendiente |
| invoices | /db/invoices, /billing/payments | Buscar, filtros, cobro, documentos, exportacion | Consulta, cartera, filtros, KPI, documentos y CSV; pago persistente, confirmacion, recuperacion tras recrear la actividad y no duplicacion verificados en MuMu con fixtures aislados |
| morosos | /db/invoices, /db/promises, /mobile/v1/collections/queue | Deuda, antiguedad, promesas, seguimiento | Cola de cobranza 0.15 con las mismas reglas web (suspendidos incluidos, anuladas y transferidas fuera), prioridad, riesgo, WhatsApp con mensaje real, llamada, cobro y aviso/corte; promesas con historial |
| tickets | /api/tickets | Consultar, crear, editar y cerrar | Reactivado en 0.15 (la web volvio a usar tickets): lista, filtros y editor versionado con lectura posterior de WispHub |
| plans | /api/plan-internet | Catalogo, ingreso y clientes por plan | Ingreso mensual, precio de la mayoria, planes por revisar y salto a la lista de clientes del plan |
| reports | /db, /metrics | Filtros, comparacion, graficas, exportacion | Facturacion por emision, 3/6/12/24 meses, comparacion, grafica, CSV y auditoria de estabilidad/WAN implementados |
| network | /mikrotik | Estado, interfaces, conectividad | Resumen SQLite, WAN, OLT, incidencias, auditoria, IPAM, recursos e interfaces MikroTik implementados; operaciones de escritura pendientes |
| bandwidth | /mikrotik | Trafico y limites | Consumo en vivo y prueba de enlace MikroTik -> cliente (cola, trafico real, ping, ARP y veredicto) compartida con la web; edicion de limites pendiente |
| auditoria-red | /network-audit | Muestras, historico, estabilidad | Lista, filtros, KPI, detalle por cliente, historial WAN y graficas nativas implementados |
| mikrotik | /mikrotik | Diagnosticos y operaciones tipadas | Identidad, recursos, salud, interfaces y ping verificado implementados; escrituras tipadas pendientes |
| IPAM (tab MikroTik) | /provisioning/ip-catalog, reservations | Rangos, validar, reservar atomicamente | Rangos locales CRUD en Room, validacion CIDR/VLAN/intervalo/exclusiones y catalogo/reserva atomica en vivo integrados al alta de cliente |
| olt | /olt-api | PON, inventario, diagnostico, operaciones y perfiles | PON, ONU, pendientes, alarmas, detalle, cliente, optica, alertas y capacidades TR-069 implementados en lectura; operaciones bloqueadas hasta certificacion fisica |
| onu-provisioner | /agent-api, /provisioning | Asistente local Android + trabajos de nube | Deteccion HTTP local sin autenticar; escritura bloqueada hasta implementar/certificar adaptadores |
| live | /mikrotik, /sync | Snapshot unico, filtros, retroceso | Snapshot compartido, KPI, consumo, presencia, diferencias, busqueda, filtros, orden y refresco adaptativo implementados en 0.8 |
| incidents | /noc | Consultar, reconocer, resolver | Consulta, clientes afectados, historial, reconocer, asignar, anotar, resolver y reabrir implementados en 0.6; certificacion Android pendiente |
| whatsapp | /wa, /templates | Conversaciones y envios explicitos | Estado, historial, plantillas y envio manual idempotente implementados; mensajes inciertos quedan en revision |
| whatsapp-bot | /wa | Configuracion y seguimiento | Estado, KPI, busqueda por nombre o numero, salto al expediente, seguir en WhatsApp y activacion idempotente por admin |
| encuestas | /api/survey | Resultados y pausa de recordatorios | Tasa de respuesta, lista filtrable y pausa/reanudacion global idempotente y auditada (solo admin); el envio de encuestas nuevas sigue en la web |
| mapa | /db/clients/map | Mapa, posiciones y captura GPS | Lista GPS filtrable, apertura del punto, captura y edicion GPS idempotente implementadas; prueba de GPS fisico pendiente |
| inventory | /inventory | Tipos, compras, seriales, asignar/devolver | Equipos, tipos, compras, materiales, seriales, asignar/devolver, filtros, historial y borradores implementados |
| expenses | /expenses | Consulta y CRUD | CRUD nativo, borradores, cliente, filtros, KPI, auditoria y reintentos implementados; protege gastos de compras/nomina |
| payroll | /employees, /payroll | Empleados, periodos, pagos | Empleados, filtros, alta/edicion/baja, periodos, pago, gasto vinculado e historial protegido implementados en 0.6; certificacion Android pendiente |
| users | /users | CRUD por rol y revocacion movil | CRUD, roles, activacion, cambio de clave y revocacion de sesiones implementados en 0.6; certificacion Android pendiente |
| settings | /db/settings | Configuracion, agentes y servidor | Servidor configurable, estado del sistema, datos publicos de empresa, sesiones y revocacion implementados; secretos permanecen solo en servidor |

## Reglas de aceptacion

- Ningun boton simula una accion ni muestra exito por recibir solamente HTTP 200.
- No eliminar facturas/clientes al cambiar de ONU ni al sincronizar.
- Sin conexion: consulta y borradores, no cobros ni reservas ni cambios de red.
- Roles explicitos: tecnico no obtiene cobranza por compartir nivel numerico.
- No guardar claves WiFi en cache publica, logs o manifests; sesiones cifradas en Android.
- Certificar EG8141A5 y F670L con firmware real, por WiFi y USB-Ethernet compatible.
- Cambiar WiFi puede desconectar: reconectar y verificar antes de finalizar.
- GenieACS permanece en el servidor actual. Android no reemplaza el ACS.
- Encuestas: solo resultados y pausa de recordatorios; APK privada; Android 10+; interfaz nativa Compose en espanol.

## Limites de esta entrega preliminar

- Es una aplicacion operativa complementaria; no reemplaza el agente Windows para configurar ONU mientras los adaptadores Android no esten certificados.
- Railway tiene `/mobile/v1` publicado en Proyectos / production / ISP max. Version, autenticacion y lectura con una cuenta real desde la APK se verificaron en MuMu Android Device-1 el 15/09/2026. La variante release acepta exclusivamente `https://isp-max-production-d0b9.up.railway.app`; solamente la variante QA permite servidores locales de pruebas.
- Las API `/mobile/v1` no utilizan la jerarquia numerica antigua. Los permisos de las rutas legacy no se han cambiado globalmente.
- Revocacion movil disponible por API y pantalla Android para administradores; lista las ultimas 100 sesiones. La pantalla web queda pendiente.
- Clientes y facturas exportan desde Railway el conjunto filtrado completo, con un limite operativo de 20,000 registros. Los catalogos secundarios todavia exportan la pagina visible.
- Consulta optica/WAN usa las muestras SQLite, con su fecha; no ejecuta speedtests ni comandos de red.
- No hay ninguna operacion de configuracion de ONU habilitada desde Android. Los controles visibles explican la capacidad faltante y no simulan ejecucion.
- Recibos y facturas usan `shared/invoice-renderer.ts` tanto en Angular como en servidor. El CommonJS de `lib` se genera y verifica antes del build web.
- Fechas de calendario de facturas se conservan sin desplazamiento UTC; se probaron tres zonas horarias.
- Consultar `android-qa.md` y `android-0.2-qa.md` para evidencia de compilacion, pruebas y limitaciones.

## Hito 0.2.0

- Agrega `GET/POST /mobile/v1/expenses`, `GET/PATCH/DELETE /mobile/v1/expenses/:id`.
- Escrituras de gastos requieren `Idempotency-Key`; edicion/eliminacion requieren `If-Match` con la version leida.
- Comparte servicio de gastos con la web, sin duplicar reglas ni desvincular compras y nomina.
- Desacuerdos de version devuelven `STALE_EXPENSE`; el editor permite descartar su borrador y recargar.
- Las respuestas inciertas mantienen bloqueado el borrador para reintentar exactamente la misma operacion.
- Sesiones se consultan en linea, sin cache; los administradores no pueden revocar sesiones de super_admin.
- Android se descarga desde Configuracion; firma privada fuera del repositorio. Sigue siendo una entrega preliminar.
- El resto de la matriz permanece pendiente donde se indica; este hito no declara la aplicacion completa.

## Hito 0.3.0

- `/mobile/v1/equipment`: operaciones tipadas con permiso administrador, idempotencia persistente y version obligatoria para modificar una unidad existente.
- `/equipment/types`: buscador paginado de tipos unitarios existentes; no convierte metros de cable en unidades ficticias.
- Servicio de negocio compartido con rutas web `/inventory/equipment`; protege asignaciones, compras vinculadas y auditoria.
- Seriales duplicados rechazados incluso con distinta capitalizacion. MAC validada y normalizada.
- No se permite cambiar una asignacion mediante el estado; devolucion y reasignacion registran sus movimientos.
- Inventario y expediente se actualizan tras una operacion; cancelar una consulta antigua impide que sobrescriba la lectura posterior al cambio.
- Android recupera conexiones HTTP reutilizadas en lecturas GET; escrituras mantienen reintento explicito y la misma clave de operacion.
- El modulo operativo requiere `equipmentWrite` anunciado por `/me`. Ante un servidor antiguo se conserva la consulta anterior.
- Evidencia y restricciones: `android-0.3-qa.md`.

## Hito 0.4.0 (en verificacion)

- Editar expediente local: alias de nombre, telefono, documento y notas. No cambia la identidad externa de WispHub ni configura MikroTik.
- Historial paginado, con proyeccion de auditoria sin JSON interno ni claves.
- Promesas conservan cliente y facturas. Cumplida es seguimiento manual, nunca confirma un cobro.
- Servicios de alias y promesas compartidos con la web. Escritura movil exige version e idempotencia persistentes; borradores inciertos quedan bloqueados para repetir la misma solicitud.
- Notas tambien conservan el intento incierto para evitar editar y reenviar con otra clave.
- Totales de facturas calculados en SQLite para el filtro completo, no la pagina. Fechas de calendario inclusivas y validadas.
- Reporte por mes de emision: cobrado corresponde a ese conjunto de facturas, no a flujo de caja. Excluye estado Anulada. Compara con el mismo numero de meses anteriores.
- Pagos reales siguen pendientes: la ruta web existente usa un bloqueo en memoria; requiere operacion durable y conciliacion antes de reutilizarla desde Android. No se habilito un boton de cobro inseguro.
- Este hito no completa Clientes, Cobros ni toda la matriz. Ver `android-0.4-qa.md` para la evidencia final.

## Hito 0.5.0 (local, en verificacion)

- Cobros durables compartidos web/Android, bloqueo por factura y recibo idempotente en SQLite.
- Formularios y consulta de solicitudes nativos; Room conserva intentos para recuperar sin duplicar.
- Confirmacion externa y lectura posterior antes de registrar exito. Pagos inciertos permanecen bloqueados.
- Contratos protegidos por `paymentsWrite`, disponibles solo cuando el servidor incorpora este modulo.
- Evidencia, bloqueo de MuMu y restricciones: `android-0.5-qa.md`.

## Hito 0.6.0 (local, en verificacion)

- Nomina nativa con empleados, filtros, formularios, borradores Room, pagos confirmados y gastos vinculados.
- Las nominas pagadas no se eliminan desde Android; se conservan como historial financiero.
- Usuarios de la web compartidos con Android: roles explicitos, altas super_admin, edicion, cambio de clave, baja y revocacion inmediata de sesiones.
- Centro de red con ultimo snapshot WAN/OLT y expediente NOC operativo con clientes afectados e historial.
- Todas las mutaciones nuevas usan idempotencia, version de lectura y auditoria en SQLite.
- Suite Node con 170 pruebas, build Angular, 9 pruebas Python y build Android aprobados localmente.
- Esta version todavia no completa MikroTik, IPAM, operaciones OLT/ONU, tickets, WhatsApp, mapa ni configuracion.

## Hito 0.7.0 (desplegado y verificado)

- Alta de clientes reutiliza el aprovisionamiento compartido WispHub, MikroTik y SQLite, con IPAM en vivo, reserva atomica e idempotencia.
- Auditoria de red por cliente, historico WAN, catalogo IPAM, mapa de clientes y centro de estado disponibles como pantallas Compose nativas.
- OLT movil incorpora PON, inventario ONU, pendientes, alarmas, detalle optico, cliente asociado y capacidades TR-069 sanitizadas. Las escrituras continuan bloqueadas hasta certificarlas con hardware recuperable.
- WhatsApp incorpora estado, historial, plantillas y envio manual a telefonos tomados del cliente. El intento se persiste antes del envio y una respuesta incierta no se repite automaticamente.
- El expediente permite limitar como moroso, reactivar y bloquear segun rol y piloto, con auditoria e idempotencia persistentes.
- Backend movil con 36 pruebas de contrato y regresion completa aprobadas. La APK firmada fue verificada en MuMu Android Device-1, en vertical y horizontal, contra Railway; el telefono fisico y las operaciones de infraestructura destructivas siguen siendo certificaciones separadas.

## Hito 0.8.0 (desplegado y verificado)

- Monitoreo en vivo nativo con presencia, transmision, consumo, limites, diferencias, busqueda, filtros, orden y paginacion.
- La API movil reutiliza el snapshot compartido de MikroTik para evitar lecturas RouterOS duplicadas por cada telefono.
- Resumen MikroTik nativo con identidad, RouterOS, placa, uptime, CPU, memoria e interfaces desde caches compartidas.
- Refresco adaptativo y controles de capacidad por rol; ninguna escritura RouterOS fue habilitada implicitamente.
- Regresion: 181 pruebas Node y 18 pruebas Android aprobadas. APK firmada verificada contra Railway y en MuMu Android Device-1 con datos reales.
- Evidencia completa: `docs/android-0.8-qa.md`.

## Hito 0.9.0 (desplegado y verificado)

- Diagnostico ping tipado desde MikroTik, limitado a IP valida y cinco paquetes.
- El resultado se confirma contra RouterOS y deja auditoria SQLite antes de mostrarse en Android.
- La pantalla MikroTik integra el formulario y el resultado sin salir del modulo.
- Se corrigio el refresco adaptativo para responder a fallos posteriores a la primera carga.
- Regresion de 182 pruebas Node y 18 pruebas Android aprobada; APK firmada validada en MuMu contra produccion.
- Evidencia completa: `docs/android-0.9-qa.md`.

## Hito 0.10.0 (desplegado y verificado)

- Captura o edicion GPS desde el expediente, con validacion, permiso Android e idempotencia persistente.
- Guarda coordenadas, precision, fecha y tecnico en SQLite y actualiza el mapa, sin escribir datos no certificados en WispHub.
- Regresion de 182 pruebas Node y 18 pruebas Android aprobada; APK firmada validada en MuMu contra produccion.
- Evidencia completa: `docs/android-0.10-qa.md`.

## Hito 0.11.0 (desplegado y verificado)

- Estado, KPI y conversaciones del bot WhatsApp integrados en una pestaña Android nativa.
- Activacion y desactivacion limitadas a administracion, con confirmacion, idempotencia y auditoria SQLite.
- Regresion de 182 pruebas Node y 18 pruebas Android aprobada; APK firmada y descarga de produccion verificadas en MuMu.
- El contexto binario de futuros despliegues se redujo conservando las versiones antiguas fuera de Docker.
- Evidencia completa: `docs/android-0.11-qa.md`.

## Hito 0.12.0 (desplegado y verificado)

- Edicion de identidad y servicio WispHub desde el expediente Android, separada de alias y notas locales.
- La API relee WispHub, exige version e idempotencia, actualiza SQLite solamente tras confirmar y rechaza respuestas que no aplicaron el cambio.
- La clave WiFi es de escritura unica: no se devuelve, no se registra en auditoria ni se persiste en el recibo movil.
- Regresion de 183 pruebas Node y 18 pruebas Android aprobada; formularios y escritura completa verificados en MuMu con fixtures aislados.
- Railway quedo en `SUCCESS`; MuMu abrio la lectura viva de WispHub en produccion sin ejecutar ninguna escritura real.
- Evidencia completa: `docs/android-0.12-qa.md`.

## Hito 0.13.0 (desplegado y verificado)

- Rangos IP administrables localmente en Room con migracion aditiva, prioridad, VLAN, gateway, DNS, intervalo utilizable y exclusiones.
- El alta de cliente consulta todos los rangos activos, descarta direcciones excluidas y exige validacion y reserva viva antes de continuar.
- Tickets WispHub nativos: alta, edicion y cierre con cliente buscable, catalogos sincronizados, borrador recuperable, version e idempotencia.
- Una escritura de ticket solo se confirma si la lectura posterior coincide en cliente, asunto, descripcion, tecnico, estado y prioridad.
- Regresion Node con 184 pruebas, 25 pruebas Android unitarias y 10 instrumentadas aprobadas; flujo completo de tickets, IPAM, pago y persistencia verificado en MuMu contra el servidor QA aislado.
- APK firmada instalada sobre 0.12 sin perder sesion ni datos. Railway quedo en `SUCCESS`, con SQLite `/data/data.db`, salud correcta y sincronizaciones activas.
- Se amplio el `keep-alive` HTTP del servidor para mantener estables las escrituras moviles no reintentables mientras el tecnico revisa formularios.
- Evidencia completa: `docs/android-0.13-qa.md`.

## Hito 0.13.1 (desplegado y verificado)

- La variante release queda fijada a la base real del servicio `ISP max` mediante `https://isp-max-production-d0b9.up.railway.app`; rechaza cualquier otro origen aunque use HTTPS.
- Solamente la variante debug/QA permite seleccionar un servidor local. Los fixtures permanecen fuera de `src/main` y no se empaquetan en el APK firmado.
- Room conserva exclusivamente sesiones cifradas, preferencias, rangos locales, borradores y snapshots reales identificados como cache; las escrituras siempre requieren Railway en vivo.
- Tickets se retiro de la navegacion Android por decision operativa. El contrato del backend se conserva por compatibilidad con versiones anteriores.
- APK firmada `0.13.1-preview`, `versionCode=16`, instalada sobre 0.13 en MuMu Device-1 sin perder la sesion. Railway quedo en `SUCCESS` y la lectura autenticada devolvio 398 clientes y 9370 facturas desde `source=sqlite`.
- Evidencia completa: `docs/android-0.13.1-qa.md`.

## Hito 0.14.0 (desplegado y verificado)

- Clientes y facturas dejan de exportar solamente la pagina visible: el backend consulta el conjunto filtrado completo directamente en SQLite de Railway.
- La app valida `source=sqlite` y que `items.length` coincida con `total`; una respuesta parcial o sin conexion no genera el CSV.
- La exportacion financiera conserva el permiso de cobranza y aplica los mismos filtros de estado, zona, forma de pago y fechas que la lista.
- El limite de 20,000 filas evita respuestas no acotadas; al superarlo se exige aplicar filtros adicionales.
- Regresion de 185 pruebas Node y 25 pruebas Android aprobada. Build web, variante debug, release firmada, `lintVital` y validacion portable finalizaron correctamente.
- Railway quedo en `SUCCESS` con SQLite conectado. La verificacion autenticada devolvio 398 clientes, 343 activos, 9,370 facturas y 180 ONU; las exportaciones completas coincidieron exactamente con sus totales.
- APK firmada `0.14.0-preview`, `versionCode=17`, instalada y abierta en MuMu Device-1 sin errores fatales. Evidencia completa: `docs/android-0.14-qa.md`.

## Hito 0.15.0 (desplegado y verificado)

- Alcanza a la web actualizada: cola de cobranza, encuestas, prueba de enlace, busqueda del bot, planes con ingreso y tickets.
- `/mobile/v1/collections/queue` aplica las reglas web de factura pendiente y el orden de prioridad; mensaje de WhatsApp con la plantilla de avisos.
- `/mobile/v1/clients/:id/link-test` reutiliza `runClientLinkTest` del servidor web: solo lectura, una prueba a la vez y auditada.
- `/mobile/v1/surveys` y `/surveys/reminders` (admin, idempotente, auditado); la busqueda del bot y el precio tipico por plan amplian contratos existentes.
- Expediente con llamar, WhatsApp y probar enlace. Se corrigio la lectura de telefonos vacios que Android convertia en el texto "null".
- Regresion: 192 pruebas Node y 28 pruebas Android aprobadas. Evidencia: `docs/android-0.15-qa.md`.

## Hito 0.16.0

- Puente movil: las rutas de la web (`/olt-api`, `/mikrotik`, `/tr069-api`, `/agent-api`, `/provisioning`, `/db`, `/wa`...) aceptan el token de la sesion movil (`Authorization: Bearer`). Mismo usuario, mismo rol y las mismas reglas de cada ruta que la web (`lib/mobile-bridge.js`, pruebas en `test/mobile-bridge.test.js`).
- OLT: mapa PON con clientes y señal, salud, inventario con filtros y vistas, detalle con lectura en vivo, diagnostico, historial optico, asociar/desasociar cliente, reiniciar, renombrar, retirar (vista previa del servidor + confirmacion escrita), autorizacion de ONU completa con IP y `AUTORIZAR <serial>`, instalaciones, NAP y splitters, perfiles, sincronizacion de planes (`SINCRONIZAR PLANES`), alarmas y bitacora.
- TR-069: consola completa (WiFi, LAN, DHCP, hora, ping/traceroute, pruebas, reinicio, historial con cancelar/reintentar). Las claves WiFi solo en memoria; el servidor oculta los parametros secretos por ruta.
- Configurar ONU: agentes, asistente guiado, historial, expedientes (cancelar, retirar ONU anterior) y reservas IP.
- MikroTik: resumen y salud, IPs libres, clientes y colas (crear/editar, plantillas), desconocidos, infraestructura, firewall, netwatch, respaldos y seguridad.
- Resto de la web: configuracion (empresa, avisos, aviso de pago, sistema), WhatsApp (conexion, QR, envios), encuestas, reportes de cartera, sincronizacion, prueba de velocidad, acciones extra del expediente (piloto, WispHub activar/suspender, ping, metricas).
- Las lecturas de rutas web no se guardan en disco. Un 401 de WispHub ya no cierra la sesion movil. Las solicitudes van en paralelo.
- Verificado en el emulador Vetlis_QA_API35 contra un servidor local aislado (sin OLT/MikroTik/WispHub reales): todas las pantallas abren, la operacion de reinicio muestra la vista previa del servidor, exige la confirmacion y muestra el error real ("OLT no configurada"). Pendiente: probar escrituras reales con una ONU de prueba.
