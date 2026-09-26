'use strict';

// Renombrar un cliente en los tres lugares donde vive su nombre:
//   - WispHub: `usuario_rb` del servicio (es el nombre que ISP Max muestra y sincroniza).
//   - MikroTik: el nombre de su cola simple (se encuentra por la IP del servicio).
//     WispHub NO la renombra: probado el 25/09/2026, cambia usuario_rb y la cola sigue igual.
//   - ISP Max: client.nombre en la base local.
// Primero se valida todo lo que puede fallar (nombre, cola duplicada) para no dejar nada
// a medias; si MikroTik falla despues de cambiar WispHub, se devuelve WispHub al nombre anterior.

const MIN_LENGTH = 2;
const MAX_LENGTH = 100;

function renameError(message, status = 400, code = 'INVALID_CLIENT_NAME') {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}

/** Nombre limpio: sin espacios repetidos ni caracteres de control. */
function normalizeClientName(value) {
  if (typeof value !== 'string') throw renameError('Escriba el nombre del cliente');
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < MIN_LENGTH) throw renameError('El nombre debe tener al menos 2 caracteres');
  if (name.length > MAX_LENGTH) throw renameError(`El nombre no puede pasar de ${MAX_LENGTH} caracteres`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw renameError('El nombre tiene caracteres no permitidos');
  return name;
}

/**
 * deps:
 *   readService(id)            -> { usuario_rb, ip }       (WispHub)
 *   writeServiceName(id, name) -> void                     (WispHub PATCH usuario_rb)
 *   findQueue(ip)              -> { id, name } | null       (cola simple con target ip/32)
 *   queueNameTaken(name, id)   -> boolean                   (otra cola ya usa ese nombre)
 *   renameQueue(id, name)      -> void
 *   saveLocal(id, name)        -> void                      (client.nombre + actividad)
 */
async function renameClientService({ idServicio, name, deps }) {
  const desired = normalizeClientName(name);
  const service = await deps.readService(idServicio);
  const before = String(service?.usuario_rb ?? '').trim();
  const ip = String(service?.ip ?? '').trim();

  const queue = ip ? await deps.findQueue(ip) : null;
  const queueNeedsRename = Boolean(queue && queue.name !== desired);
  if (queueNeedsRename && await deps.queueNameTaken(desired, queue.id)) {
    throw renameError(`En el MikroTik ya hay otra cola llamada "${desired}". Use otro nombre.`, 409, 'QUEUE_NAME_TAKEN');
  }

  const wisphubChanged = before !== desired;
  if (wisphubChanged) {
    await deps.writeServiceName(idServicio, desired);
    const confirmed = String((await deps.readService(idServicio))?.usuario_rb ?? '').trim();
    if (confirmed !== desired) {
      throw renameError('WispHub no confirmo el nombre nuevo. No se cambio nada en el MikroTik.', 502, 'WISPHUB_NOT_CONFIRMED');
    }
  }

  let mikrotik = queue ? 'unchanged' : 'no_queue';
  if (queueNeedsRename) {
    try {
      await deps.renameQueue(queue.id, desired);
      const after = await deps.findQueue(ip);
      if (!after || after.name !== desired) throw new Error('la cola no quedo con el nombre nuevo');
      mikrotik = 'renamed';
    } catch (error) {
      let rolledBack = !wisphubChanged;
      if (wisphubChanged) {
        try {
          await deps.writeServiceName(idServicio, before);
          rolledBack = String((await deps.readService(idServicio))?.usuario_rb ?? '').trim() === before;
        } catch { rolledBack = false; }
      }
      throw renameError(rolledBack
        ? `No se pudo renombrar la cola en el MikroTik (${error.message}). WispHub quedo con el nombre anterior.`
        : `No se pudo renombrar la cola en el MikroTik (${error.message}) y WispHub quedo con "${desired}". Revise el cliente.`,
      502, rolledBack ? 'MIKROTIK_RENAME_FAILED' : 'RENAME_PARTIAL');
    }
  }

  await deps.saveLocal(idServicio, desired);
  return {
    ok: true,
    idServicio,
    before,
    name: desired,
    wisphub: wisphubChanged ? 'renamed' : 'unchanged',
    mikrotik,
    queueName: queue ? desired : null,
  };
}

module.exports = { renameClientService, normalizeClientName, MAX_LENGTH };
