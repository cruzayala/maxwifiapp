/**
 * WhatsApp Bot conversacional
 *
 * El cliente envia un comando por WhatsApp y el bot responde
 * automaticamente con la informacion solicitada.
 *
 * Comandos soportados:
 *   menu / ayuda          - Lista de comandos
 *   saldo                 - Consulta saldo actual
 *   plan                  - Plan contratado y precio
 *   factura               - Datos de ultima factura pendiente
 *   pagar                 - Metodos de pago disponibles
 *   info                  - Datos de su cuenta (IP, plan, estado)
 *   soporte / averia      - Reporta problema (crea ticket)
 *   velocidad             - Info de plan y test
 */

function normalizePhone(jid) {
  // Convierte JID a numero limpio
  // 18091234567@s.whatsapp.net -> 8091234567
  const raw = jid.split('@')[0];
  // Quitar codigo pais "1" si es DR
  if (raw.startsWith('1') && raw.length === 11) return raw.substring(1);
  return raw;
}

function normalizeClientPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\+\(\)]/g, '').replace(/^1(?=\d{10}$)/, '');
}

function parseCommand(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  // Quitar acentos
  const normalized = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/^(menu|ayuda|help|hola|hi|comandos|que puedo|opciones)/i.test(normalized)) return 'menu';
  if (/^(saldo|balance|cuenta|deuda|debo)/i.test(normalized)) return 'saldo';
  if (/^(plan|servicio|velocidad mi|que tengo)/i.test(normalized)) return 'plan';
  if (/^(factura|recibo|comprobante)/i.test(normalized)) return 'factura';
  if (/^(pago|pagar|como pago|donde pago|metodo)/i.test(normalized)) return 'pagar';
  if (/^(info|informacion|mi cuenta|datos)/i.test(normalized)) return 'info';
  if (/^(soporte|averia|problema|no funciona|sin internet|reclamo|ayuda tecnica)/i.test(normalized)) return 'soporte';
  if (/^(velocidad|speedtest|test|prueba)/i.test(normalized)) return 'velocidad';

  return null;
}

async function findClientByPhone(prisma, phone) {
  if (!phone) return null;
  const clean = normalizeClientPhone(phone);

  // Probar match exacto y con sufijo (los telefonos pueden tener variaciones)
  const candidates = await prisma.client.findMany({
    where: {
      OR: [
        { telefono: clean },
        { telefono: '1' + clean },
        { telefono: { contains: clean } },
      ],
    },
    take: 5,
  });

  if (candidates.length === 0) return null;
  // Preferir el match exacto si existe
  return candidates.find(c => normalizeClientPhone(c.telefono) === clean) || candidates[0];
}

function fmtMoney(value) {
  const n = parseFloat(value || '0');
  return 'RD$ ' + n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── COMANDOS ───

function cmdMenu(client) {
  const name = client ? client.nombre.split(' ')[0] : '';
  return `Hola${name ? ' ' + name : ''}! Soy el asistente de ${process.env.INVOICE_BUSINESS_NAME || 'tu ISP'}.

Comandos disponibles:

*saldo* - Consulta tu saldo actual
*plan* - Ver plan contratado
*factura* - Datos de tu ultima factura
*pagar* - Como pagar tu servicio
*info* - Tus datos de cuenta
*soporte* - Reportar averia / problema
*velocidad* - Info de tu plan
*menu* - Ver este mensaje

Escribe la palabra y te respondo al instante.`;
}

function cmdSaldo(client) {
  if (!client) return null;
  const saldo = parseFloat(client.saldo || '0');
  const estado = client.estadoFacturas || 'N/A';
  const corte = client.fechaCorte || '';
  let msg = `*Saldo:* ${fmtMoney(saldo)}
*Estado:* ${estado}`;
  if (corte) msg += `\n*Fecha de corte:* ${corte}`;
  if (saldo > 0) {
    msg += `\n\nEscribe *pagar* para ver como saldar tu cuenta.`;
  } else if (estado.toLowerCase() === 'pagadas') {
    msg += `\n\nTu cuenta esta al dia. Gracias!`;
  }
  return msg;
}

function cmdPlan(client) {
  if (!client) return null;
  const plan = client.planInternetName || 'No definido';
  const precio = client.precioPlan || '0';
  return `*Tu Plan:* ${plan}
*Precio mensual:* ${fmtMoney(precio)}
*Estado del servicio:* ${client.estado || 'N/A'}

Escribe *velocidad* para probar tu conexion.`;
}

async function cmdFactura(prisma, client) {
  if (!client) return null;

  // Buscar ultima factura pendiente o vencida
  const factura = await prisma.invoice.findFirst({
    where: {
      clienteIdServicio: client.idServicio,
      OR: [
        { estado: { contains: 'Pendiente' } },
        { estado: 'Vencida' },
      ],
    },
    orderBy: { idFactura: 'desc' },
  });

  if (!factura) {
    return `No tienes facturas pendientes. Tu cuenta esta al dia!`;
  }

  return `*Factura #${factura.idFactura}*

*Emision:* ${factura.fechaEmision || '-'}
*Vencimiento:* ${factura.fechaVencimiento || '-'}
*Total:* ${fmtMoney(factura.total)}
*Estado:* ${factura.estado}

Escribe *pagar* para ver como pagarla.`;
}

function cmdPagar(client) {
  const bankInfo = process.env.INVOICE_BANK_INFO || '';
  const support = process.env.SUPPORT_PHONE || '';

  let msg = `*Metodos de Pago*\n\n`;

  if (bankInfo) {
    const banks = bankInfo.split('|');
    banks.forEach(b => { msg += `${b.trim()}\n`; });
  } else {
    msg += `Contactanos para coordinar el pago.\n`;
  }

  if (support) {
    msg += `\nDespues de pagar, envia el comprobante a ${support} con tu nombre o numero de servicio.`;
  } else {
    msg += `\nEnvia el comprobante de pago por aqui mismo con tu nombre.`;
  }

  if (client) {
    const saldo = parseFloat(client.saldo || '0');
    if (saldo > 0) msg += `\n\nTu saldo actual: ${fmtMoney(saldo)}`;
  }

  return msg;
}

function cmdInfo(client) {
  if (!client) return null;
  return `*Tu Cuenta*

*Nombre:* ${client.nombre}
*Plan:* ${client.planInternetName || '-'}
*Precio:* ${fmtMoney(client.precioPlan || 0)}
*Estado:* ${client.estado || '-'}
*Direccion:* ${client.direccion || '-'}
*Fecha instalacion:* ${client.fechaInstalacion || '-'}

Otros comandos: *saldo*, *factura*, *soporte*`;
}

async function cmdSoporte(prisma, client, fullMessage) {
  if (!client) return null;
  // Guardar en notas del cliente para que el admin lo vea
  const note = `[BOT WhatsApp] Reporte de soporte: "${fullMessage.substring(0, 500)}"`;
  try {
    await prisma.clientNote.create({
      data: {
        idServicio: client.idServicio,
        clientName: client.nombre,
        title: 'Reporte por WhatsApp',
        note,
        priority: 'high',
      },
    });
  } catch {}

  const support = process.env.SUPPORT_PHONE || '';
  return `*Tu reporte fue registrado*

Un tecnico revisara tu caso y se comunicara contigo lo antes posible.

${support ? `Si es urgente, llamanos al ${support}` : ''}

Recuerda revisar:
- Que tu equipo (router) este encendido
- Cables conectados
- Esperar 2 minutos despues de reiniciar`;
}

function cmdVelocidad(client) {
  if (!client) return null;
  const plan = client.planInternetName || 'Plan estandar';
  return `*Tu Plan: ${plan}*

Para probar tu velocidad:
1. Ve a www.fast.com en tu navegador
2. O descarga la app *Speedtest by Ookla*
3. Hazlo conectado por cable (no WiFi) para resultado real

Si tu velocidad esta muy baja escribe *soporte* y revisamos tu conexion.`;
}

// ─── HANDLER PRINCIPAL ───

async function handleIncomingMessage(prisma, waSocket, msg) {
  try {
    // Ignorar mensajes propios y de grupo
    if (!msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid?.endsWith('@g.us')) return;
    if (msg.key.remoteJid?.endsWith('@broadcast')) return;

    const text = msg.message.conversation
      || msg.message.extendedTextMessage?.text
      || msg.message.imageMessage?.caption
      || '';

    if (!text) return;

    const phone = normalizePhone(msg.key.remoteJid);
    const command = parseCommand(text);

    // Loguear conversacion entrante
    const client = await findClientByPhone(prisma, phone);
    await prisma.whatsappLog.create({
      data: {
        phone,
        message: '< ' + text.substring(0, 500),
        idServicio: client?.idServicio || null,
        clientName: client?.nombre || null,
        messageType: 'incoming',
        status: 'received',
      },
    }).catch(() => {});

    // Verificar si el bot esta habilitado
    const botEnabled = await prisma.appSetting.findUnique({ where: { key: 'whatsapp_bot_enabled' } });
    if (botEnabled?.value !== 'true') return;

    // Solo responder si parsea un comando
    if (!command) {
      // Si el cliente existe y manda algo no comando, mandar menu
      if (client) {
        await sendReply(waSocket, msg.key.remoteJid, prisma, client, 'menu', cmdMenu(client));
      }
      return;
    }

    // Generar respuesta
    let reply = null;
    switch (command) {
      case 'menu': reply = cmdMenu(client); break;
      case 'saldo': reply = client ? cmdSaldo(client) : 'No encontre tu cuenta. Verifica que registramos tu numero o llama a soporte.'; break;
      case 'plan': reply = client ? cmdPlan(client) : 'No encontre tu cuenta. Verifica que registramos tu numero.'; break;
      case 'factura': reply = client ? await cmdFactura(prisma, client) : 'No encontre tu cuenta.'; break;
      case 'pagar': reply = cmdPagar(client); break;
      case 'info': reply = client ? cmdInfo(client) : 'No encontre tu cuenta. Llama a soporte.'; break;
      case 'soporte': reply = client ? await cmdSoporte(prisma, client, text) : 'Para soporte, comunicate al ' + (process.env.SUPPORT_PHONE || 'numero de la empresa'); break;
      case 'velocidad': reply = client ? cmdVelocidad(client) : 'No encontre tu cuenta.'; break;
    }

    if (reply) {
      await sendReply(waSocket, msg.key.remoteJid, prisma, client, command, reply);
    }
  } catch (e) {
    console.error('[Bot] Error handling message:', e.message);
  }
}

async function sendReply(waSocket, jid, prisma, client, command, reply) {
  try {
    await waSocket.sendMessage(jid, { text: reply });
    await prisma.whatsappLog.create({
      data: {
        phone: normalizePhone(jid),
        message: '> ' + reply.substring(0, 500),
        idServicio: client?.idServicio || null,
        clientName: client?.nombre || null,
        messageType: 'bot_' + command,
        status: 'sent',
      },
    });
  } catch (e) {
    console.error('[Bot] Error sending reply:', e.message);
  }
}

module.exports = { handleIncomingMessage, parseCommand };
