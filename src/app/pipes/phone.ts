/**
 * Utilidades de teléfono para República Dominicana (códigos 809, 829 y 849).
 * Solo generan enlaces: el operador revisa y envía el mensaje desde su propio WhatsApp.
 */

/** Dígitos en formato internacional (1 + 10 dígitos) o null si no parece un número válido. */
export function internationalDrPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && /^(809|829|849)/.test(digits)) return `1${digits}`;
  if (digits.length === 11 && /^1(809|829|849)/.test(digits)) return digits;
  // Otros países o formatos: se acepta si trae código de país razonable.
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Enlace de WhatsApp (wa.me) con mensaje opcional ya escrito. */
export function whatsappLink(phone: string | null | undefined, message?: string): string | null {
  const intl = internationalDrPhone(phone);
  if (!intl) return null;
  return `https://wa.me/${intl}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

/** Enlace para llamar desde el celular. */
export function telLink(phone: string | null | undefined): string | null {
  const intl = internationalDrPhone(phone);
  return intl ? `tel:+${intl}` : null;
}

/** "18097723061" -> "(809) 772-3061" para mostrar. */
export function formatDrPhone(phone: string | null | undefined): string {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return raw;
}
