'use strict';

const crypto = require('node:crypto');

const MOBILE_ROLES = new Set(['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer']);
const hash = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

/**
 * La app Android usa las mismas rutas que la web con su sesion movil: mismo usuario,
 * mismo rol y las mismas reglas de cada ruta. Valida el token de acceso igual que /mobile/v1
 * (revocada, vencida, usuario inactivo o clave cambiada).
 */
async function mobileBridgeSession(prisma, token, now = new Date()) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 200) {
    return { error: { error: 'Inicia sesion', code: 'ACCESS_EXPIRED' } };
  }
  const session = await prisma.mobileSession.findUnique({ where: { accessHash: hash(token) } });
  const user = session && await prisma.user.findUnique({ where: { id: session.userId } });
  if (!session || session.revokedAt || session.expiresAt <= now || !user?.isActive || !MOBILE_ROLES.has(user.role)
    || session.passwordStamp !== hash(user.passwordHash)) {
    return { error: { error: 'Sesion revocada', code: 'SESSION_REVOKED' } };
  }
  if (session.accessExpiresAt <= now) return { error: { error: 'Renueva la sesion', code: 'ACCESS_EXPIRED' } };
  return {
    session: {
      userId: user.id, username: user.username, role: user.role,
      mobileSessionId: session.id, expiresAt: session.accessExpiresAt.getTime(),
    },
  };
}

module.exports = { mobileBridgeSession };
