/** El enlace debe proceder del recibo de publicación; nunca se construye con un ASIN de ejemplo. */
export function amazonPublicationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['amazon.es', 'www.amazon.es'].includes(url.hostname)
      || url.username || url.password || url.port || !/\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname)) return;
    return url.href;
  } catch { return; }
}

export function publicationMessage(url?: string): string {
  return url
    ? 'Tu producto ya está publicado en Amazon. Aquí tienes el enlace para verlo.'
    : 'He terminado el recorrido. Todavía no tengo un enlace confirmado para ver el producto en Amazon.';
}
