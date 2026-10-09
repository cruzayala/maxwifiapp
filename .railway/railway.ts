import { defineRailway, preserve, project, service, volume } from "railway/iac";

// Configuracion de Railway del servicio "ISP max" (reemplaza a railway.json, que Railway deja
// de leer el 01/12/2026).
//
// PARCIAL A PROPOSITO: el proyecto "Proyectos" tambien tiene servicios de otros sistemas
// (MediClick, sisfact, Device Studio y sus bases). Este repositorio solo maneja "ISP max";
// no agregues aqui nada de los demas.
export const partial = "isp-max";

export default defineRailway(() => {
  const ispMaxVolume = volume("isp-max-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });
  const ISPMax = service("ISP max", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // Igual que el CMD del Dockerfile: aplica el esquema de Prisma y arranca.
    start: "sh -c \"npx prisma db push --skip-generate && exec node server.js\"",
    // Un deploy nuevo solo reemplaza al anterior cuando /health responde.
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "isp-max" },
    volumeMounts: { "/data": ispMaxVolume },
    env: { ADMIN_FULL_NAME: preserve(), ADMIN_PASSWORD: preserve(), ADMIN_USERNAME: preserve(), AUTO_BLOCK_ENABLED: preserve(), CAPTIVE_AUTOCONFIG: preserve(), DATABASE_URL: preserve(), INVOICE_BUSINESS_NAME: preserve(), MIKROTIK_ENABLED: preserve(), MIKROTIK_HOST: preserve(), MIKROTIK_PASS: preserve(), MIKROTIK_PORT: preserve(), MIKROTIK_TLS: preserve(), MIKROTIK_TLS_CA_B64: preserve(), MIKROTIK_USER: preserve(), NOC_ENABLED: preserve(), NOC_INTERVAL_MS: preserve(), NOC_MIN_AFFECTED: preserve(), NOC_MIN_RATIO: preserve(), NODE_ENV: preserve(), NOTIF_ENABLED: preserve(), OLT_AUTO_AUTHORIZE_AGENT: preserve(), OLT_COMMAND_TIMEOUT_MS: preserve(), OLT_CONNECT_TIMEOUT_MS: preserve(), OLT_ENABLED: preserve(), OLT_HOST: preserve(), OLT_INVENTORY_INTERVAL_MS: preserve(), OLT_PASS: preserve(), OLT_PORT: preserve(), OLT_SYNC_INTERVAL_MS: preserve(), OLT_USER: preserve(), SURVEY_REMINDERS_ENABLED: preserve(), SYNC_INTERVAL_MS: preserve(), TR069_TASK_ENCRYPTION_KEY: preserve(), WEB_ACTIVITY_ENABLED: preserve(), WHATSAPP_AUTOSTART: preserve(), WISPHUB_API_KEY: preserve(), WISPHUB_SYNC_ENABLED: preserve() },
  });

  return project("Proyectos", {
    resources: [ISPMax, ispMaxVolume],
  });
});
