# Android 0.2.1-preview: servidor recordado y controles visuales

## Cambios

- Direccion Railway incluida en DEFAULT_SERVER. Login usa el servidor de la sesion o la preferencia interna.
- mobile-server.dat guarda unicamente el origen validado, sin contrasenas ni tokens, separado del archivo cifrado de sesion y excluido de copias de seguridad Android.
- Se conserva tras logout, revocacion y reinicio. Se migra el origen de sesiones existentes. Direcciones invalidas recuperan el origen predeterminado.
- Un servidor alternativo se recuerda despues de autenticarse correctamente; opcion visual para volver a la nube ISP Max.
- Botones primarios compartidos con elevacion, respuesta de pulsacion de 120 ms e iconos de accion.
- Iconos vectoriales con relieve en login, indicadores y accesos a modulos; seleccion animada en navegacion y transiciones de pantalla de 100-180 ms. Sin animaciones continuas ni motor 3D.
- Ninguna accion de infraestructura nueva; se conservan permisos, formularios y bloqueo de configuracion ONU no certificada.

## Verificacion

- 10 pruebas unitarias, build debug/release y lint aprobados.
- 6 pruebas instrumentadas aprobadas en MuMu Android Device-1: telefono 540x960 y formato tableta 1280x800. Resolucion/densidad restauradas al terminar.
- Pruebas de persistencia tras revocacion/logout, rechazo de URL con credenciales, archivo corrupto, reinicio de actividad, filtros, gastos, borradores y roles.
- Capturas inspeccionadas en output/android-0.2.1-qa: login, resumen, Red, gastos y tableta. No se certifica accesibilidad completa solo mediante capturas.
- APK versionCode 4, firma RSA conservada, instalada sin borrar datos en com.ispmax.mobile. Crash buffer vacio despues de las pruebas.
- SHA256: cbc9770bfe61112da2c5b56fb1c7da15bc9954ed16fec18889adeee899d31d8c.
- Servidor QA aislado detenido y reverse ADB retirado. No se modificaron clientes, pagos, red ni otras instancias MuMu.
- Esta actualizacion es local; no se ha reemplazado el APK de descarga en Railway durante este cambio. El backend existente no requiere migraciones.

La matriz funcional sigue siendo la de android-parity.md. Este hito visual no completa las operaciones aun pendientes.
