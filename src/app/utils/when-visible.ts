/**
 * Envuelve el trabajo de un setInterval para que no corra con la pestaña oculta.
 *
 * Las pantallas que quedaban abiertas en segundo plano todo el día seguían consultando al
 * servidor (y este al MikroTik y a la OLT) cada pocos segundos aunque nadie las mirara.
 * Al volver a la pestaña, el siguiente ciclo trae los datos al día.
 */
export function whenVisible(work: () => void): () => void {
  return () => {
    if (isHidden()) return;
    work();
  };
}

export function isHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}
