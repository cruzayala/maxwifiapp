# Configuracion de Railway (ISP max)

`railway.ts` define la configuracion del servicio **"ISP max"**: compilacion con el
Dockerfile, comando de arranque y verificacion de salud (`/health`, 120 s). Reemplaza a
`railway.json`, que Railway deja de leer el 01/12/2026. Se aplico el 09/10/2026.

## Cuidado

- El proyecto de Railway **"Proyectos" tiene servicios de otros sistemas** (MediClick,
  sisfact, Device Studio y sus bases). Este archivo es **parcial** (`export const partial`)
  y solo describe "ISP max". **No uses `railway config pull`** para regenerarlo: trae todo
  el proyecto y un `apply` desde aqui podria cambiar los otros sistemas.
- Las variables usan `preserve()`: se conservan las de Railway, nunca se escriben desde aqui.

## Cambiar algo

```bash
npm install --no-save railway
/c/Users/maxim/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe config plan
/c/Users/maxim/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe config apply
```

En Windows hay que llamar al `railway.exe` directamente (sin `timeout` ni el atajo de npm):
el SDK comprueba la version del CLI con el ejecutable que lo invoco y con el atajo falla.
Revisa que el plan diga `0 to destroy` y que solo cambie "ISP max" antes de aplicar.
