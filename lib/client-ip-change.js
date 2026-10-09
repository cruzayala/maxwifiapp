'use strict';

// Cambiar la IP de un cliente en los tres lugares donde vive:
//   - WispHub: `ip` del servicio (confirmada al releer);
//   - MikroTik: el target de su cola simple (WispHub no la mueve);
//   - ISP Max: client.ip.
// Antes de tocar nada se comprueba que la IP sea valida y que nadie mas la use, en
// ISP Max ni en el MikroTik. Si el MikroTik falla despues de cambiar WispHub, WispHub
// vuelve a la IP anterior para no dejar el servicio a medias.

const { isIP } = require('node:net');
const { readWisphubService } = require('./client-rename');

function ipError(message, status = 400, code = 'INVALID_CLIENT_IP') {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}

function normalizeClientIp(value) {
  const ip = String(value ?? '').trim();
  if (isIP(ip) !== 4) throw ipError('Escriba una IP valida, por ejemplo 192.168.16.40');
  if (/^(0|127|255)\./.test(ip) || ip.endsWith('.0') || ip.endsWith('.255')) throw ipError(`${ip} no puede asignarse a un cliente`);
  return ip;
}

/**
 * deps:
 *   readService(id)            -> { ip }                     (WispHub)
 *   writeServiceIp(id, ip)     -> void
 *   localOwner(ip, id)         -> { idServicio, nombre } | null (otro cliente con esa IP en ISP Max)
 *   findQueue(ip)              -> { id, name } | null          (cola con target ip/32)
 *   retargetQueue(id, ip)      -> void
 *   saveLocal(id, ip, before)  -> void
 */
async function changeClientIp({ idServicio, ip, deps }) {
  const desired = normalizeClientIp(ip);
  const service = await readWisphubService(deps.readService, idServicio);
  const before = String(service?.ip ?? '').trim();
  if (before === desired) return { ok: true, idServicio, before, ip: desired, wisphub: 'unchanged', mikrotik: 'unchanged' };

  const owner = await deps.localOwner(desired, idServicio);
  if (owner) throw ipError(`La IP ${desired} ya es de ${owner.nombre} (#${owner.idServicio}).`, 409, 'IP_IN_USE');
  const taken = await deps.findQueue(desired);
  if (taken) throw ipError(`En el MikroTik ya hay una cola para ${desired} ("${taken.name}").`, 409, 'IP_IN_USE');
  const queue = before ? await deps.findQueue(before) : null;

  await deps.writeServiceIp(idServicio, desired);
  const confirmed = String((await deps.readService(idServicio))?.ip ?? '').trim();
  if (confirmed !== desired) throw ipError('WispHub no confirmo la IP nueva. No se cambio nada en el MikroTik.', 502, 'WISPHUB_NOT_CONFIRMED');

  let mikrotik = queue ? 'moved' : 'no_queue';
  if (queue) {
    try {
      await deps.retargetQueue(queue.id, desired);
      const moved = await deps.findQueue(desired);
      if (!moved || moved.id !== queue.id) throw new Error('la cola no quedo con la IP nueva');
    } catch (error) {
      let rolledBack = false;
      try {
        await deps.writeServiceIp(idServicio, before);
        rolledBack = String((await deps.readService(idServicio))?.ip ?? '').trim() === before;
      } catch { rolledBack = false; }
      throw ipError(rolledBack
        ? `No se pudo mover la cola en el MikroTik (${error.message}). WispHub quedo con la IP anterior.`
        : `No se pudo mover la cola en el MikroTik (${error.message}) y WispHub quedo con ${desired}. Revise el cliente.`,
      502, rolledBack ? 'MIKROTIK_IP_FAILED' : 'IP_CHANGE_PARTIAL');
    }
  }

  await deps.saveLocal(idServicio, desired, before);
  return { ok: true, idServicio, before, ip: desired, wisphub: 'changed', mikrotik, queueName: queue?.name || null };
}

module.exports = { changeClientIp, normalizeClientIp };
