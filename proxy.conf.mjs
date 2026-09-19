// Proxy del servidor de desarrollo de Angular hacia el backend (server.js).
// Algunas rutas de la API coinciden con paginas de Angular (/users, /expenses...):
// cuando el navegador navega a ellas (Accept: text/html) se sirve la app en vez de proxear.
const target = 'http://localhost:7400';

const apiPrefixes = [
  '/api', '/db', '/billing', '/wa', '/clients-actions', '/web-activity', '/mikrotik/',
  '/olt-api', '/tr069-api', '/agent-api', '/android-api', '/provisioning', '/client-provisioning',
  '/sync', '/noc', '/network-audit/', '/captive', '/auth', '/health', '/metrics', '/ops',
  '/payment-warning', '/employees', '/mobile',
];

// Prefijos compartidos con paginas de Angular.
const sharedWithPages = ['/clients', '/users', '/inventory', '/expenses', '/payroll'];

const serveAppOnNavigation = (req) =>
  req.method === 'GET' && String(req.headers.accept || '').includes('text/html') ? '/index.html' : undefined;

const config = {};
for (const prefix of apiPrefixes) {
  config[prefix] = { target, secure: false, changeOrigin: true };
}
for (const prefix of sharedWithPages) {
  config[prefix] = { target, secure: false, changeOrigin: true, bypass: serveAppOnNavigation };
}

export default config;
