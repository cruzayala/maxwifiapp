# ISP Max Android

Aplicacion nativa Kotlin/Compose. Desarrollo incremental; consultar
`../docs/android-parity.md` antes de considerar un modulo certificado.

## Compilar

JDK 17, SDK Android 35, Android 10+ en el dispositivo. Configure ANDROID_HOME.

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

La version debug permite HTTP para QA local. Release exige HTTPS al servidor.
Debug se instala como `com.ispmax.mobile.qa` (ISP Max QA), separado de la APK
firmada `com.ispmax.mobile`, para no sustituir la instalacion del usuario.
No se incluyen contrasenas, tokens, bases de clientes ni firma privada.
La web y el agente Windows existentes no se sustituyen al instalar este APK.

## Firma privada

Definir ISPMAX_ANDROID_KEYSTORE, ISPMAX_ANDROID_STORE_PASSWORD,
ISPMAX_ANDROID_KEY_ALIAS e ISPMAX_ANDROID_KEY_PASSWORD fuera del repositorio.
Conservar copia segura de esa firma: las actualizaciones requieren la misma clave.

```powershell
.\gradlew.bat :app:assembleRelease
```

La instalacion de actualizaciones siempre requiere consentimiento de Android.

En esta PC, `scripts/build-android-private.ps1` (desde la raiz del repositorio)
genera/usa la firma privada en `%LOCALAPPDATA%\ISP Max\AndroidSigning`.
La credencial esta protegida con DPAPI del usuario Windows. El script comprueba
la firma del APK; si falta una parte del par de archivos, no crea otra firma.
Respaldar la clave por un canal seguro antes de cambiar de PC.

## API y QA aislado

Las API nativas estan en `/mobile/v1`; necesitan las nuevas tablas de Prisma.
Desplegadas en Proyectos / production / ISP max con el hito 0.2.0-preview.
La APK firmada es preliminar, no
un reemplazo funcional completo del sistema ni del configurador Windows.
Antes de migrar un servidor existente, respaldar SQLite y ejecutar su flujo normal
de `prisma db push`/generacion. No usar una base de produccion como fixture.

```powershell
node scripts/mobile-qa-server.js
```

Este comando, desde la raiz del repositorio, crea una base desechable en TEMP y
escucha solo en 127.0.0.1:7415. Contiene datos ficticios y no carga server.js ni
inicia sincronizaciones. En el emulador usar `adb reverse tcp:7415 tcp:7415` y
`http://127.0.0.1:7415` como servidor debug.

Pruebas: `node --test test/mobile-api.test.js test/invoice-renderer.test.js` y
`:app:testDebugUnitTest`, `:app:assembleDebugAndroidTest`. El flujo instrumentado
usa solamente `qa-admin / qa-only-12345` de ese servidor aislado.
Runner debug: `com.ispmax.mobile.qa.test/androidx.test.runner.AndroidJUnitRunner`.
En emuladores con UiAutomation ocupado se puede usar `-e skipExternalPrint true`;
esa ejecucion NO certifica impresion del sistema. Las capturas de documentos
deben comprobarse tambien con `adb shell screencap` si el visor sale en blanco.

Si dl.google.com tiene problemas de descarga, el CDN de Google probado admite
`-PgoogleMavenUrl=https://redirector.gvt1.com/edgedl/android/maven2/`.

La unica WebView de la aplicacion renderiza facturas para impresion. JavaScript,
acceso a archivos y cargas de red estan bloqueados; no contiene navegacion de la app.

Room exporta el esquema inicial en `app/schemas`. Cualquier cambio de version
debera agregar una migracion explicita y probar la conservacion de borradores.
No existe `fallbackToDestructiveMigration`.
