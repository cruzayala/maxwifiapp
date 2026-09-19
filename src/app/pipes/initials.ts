/**
 * Iniciales para avatares usando solo letras:
 * "paola 2" -> "P", "`la de la banca 15" -> "LD", "Ana Torres" -> "AT".
 */
export function initialsOf(name: string | null | undefined, fallback = '#'): string {
  const words = String(name || '').match(/\p{L}+/gu) || [];
  const initials = ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase();
  return initials || fallback;
}
