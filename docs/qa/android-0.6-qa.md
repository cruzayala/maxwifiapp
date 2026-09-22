# ISP Max Android 0.6.0-preview: administracion y NOC

## Implementado

- Empleados y nomina con API movil tipada, filtros, paginacion, formularios, borradores Room y control de versiones.
- Pago de nomina idempotente con gasto vinculado. Un pago confirmado se conserva y no puede eliminarse desde Android.
- Usuarios compartidos con la web, roles explicitos, cambio de clave y revocacion de sesiones.
- Resumen de red persistido y ciclo NOC: reconocer, asignar, anotar, resolver y reabrir.
- Dependencias generadas de GenieACS y builds locales excluidas correctamente de Git.

## Evidencia local

- `npm test`: 170 pruebas aprobadas.
- `npm run build`: Angular aprobado; permanecen advertencias conocidas de presupuesto, OLT SCSS y MapLibre CommonJS.
- `pytest test/test_onu_provisioner.py`: 9 pruebas aprobadas.
- `gradlew :app:testDebugUnitTest :app:assembleDebug`: aprobado con Android SDK 35.

## Pendiente antes de publicar

- Prueba instrumentada en MuMu Device-1 y revision visual en telefono/tableta.
- Migracion y respaldo consistente del SQLite de Railway.
- Completar inventario de compras/materiales, tickets, MikroTik/IPAM, OLT/ONU, WhatsApp, mapa y configuracion.
- No se ejecutaron pagos reales, cambios de red ni operaciones OLT durante este hito.
