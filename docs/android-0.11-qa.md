# ISP Max Android 0.11.0-preview: bot WhatsApp

## Alcance

- Agrega una pestaña Bot dentro del modulo WhatsApp.
- Presenta estado real de WhatsApp y del bot, mensajes recibidos, respuestas y conversaciones.
- Lista conversaciones recientes desde SQLite sin consultar secretos de Baileys.
- Permite activar o desactivar solo a super_admin/admin, con confirmacion, idempotencia y auditoria.
- Cobranza conserva acceso de lectura y no puede cambiar el estado.

## Evidencia

- Regresion del servidor: 182 pruebas aprobadas, incluida lectura, permisos, idempotencia y conflicto de clave del bot.
- Android: 18 pruebas aprobadas; `assembleDebug`, `assembleRelease`, lint vital y firma v2 aprobados.
- Railway `Proyectos / production / ISP max`: despliegue `dc5eddc4-b206-4cb7-a8ef-79e9e1e023ec` finalizado en `SUCCESS`.
- `/health` respondio `ok`, con SQLite y MikroTik conectados.
- Produccion confirmo `whatsappBotManage=true` para super_admin y devolvio el estado real sin modificarlo.
- MuMu Android Device-1: APK instalada como versionCode 13; estado, KPI y vacio de conversaciones verificados.
- Captura: `android/app/build/reports/ispmax-0.11-production-whatsapp-bot.png`.
- APK: `agent-downloads/ISP-Max-Android-0.11.0-preview.apk`, 44,329,975 bytes, SHA-256 `560d6a51be08dcaffc68d07150f63563d77998c6bd650351cdd6e3be1d6acd2c`.
- La descarga autenticada de produccion devolvio la misma huella SHA-256.

## Empaquetado

- `agent-downloads` conserva solamente el APK y el instalador seleccionados por sus manifiestos.
- Las versiones Android anteriores permanecen en `output/android-release`, excluido del contexto Docker.
- El contenido binario enviado en futuros despliegues baja de aproximadamente 472 MB a 106 MB.

## Limites

- WhatsApp estaba desconectado y el bot inactivo durante QA; no se cambio ese estado en produccion.
- La prueba aislada certifica la mutacion completa sin usar conversaciones reales.
- El bot responde por la infraestructura existente; Android no almacena credenciales de WhatsApp.
