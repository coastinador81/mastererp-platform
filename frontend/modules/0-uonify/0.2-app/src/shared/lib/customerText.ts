/** Solo presentación: las rutas, versiones y citas originales se conservan en las evidencias. */
export function customerText(value: string): string {
  return value
    .replace(/\$\.[\w.[\]"'/-]+/g, '')
    .replace(/\b(?:versi[oó]n|fragmento|citationId|sourceVersion|fragmentId)\s*[:=]?\s*[a-zA-Z0-9_-]{8,}/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{16,64}\b/gi, '')
    .replace(/(?:[·|]\s*){2,}/g, ' · ')
    .replace(/\s+([.,;])/g, '$1').replace(/^[\s·|.,;]+|[\s·|]+$/g, '').trim();
}

export function customerSource(value: string): string {
  const plain = customerText(value).replace(/\s*[·|][.·|\s]*[«“"].*$/u, '').replace(/[.·|\s]+$/, '').replace(/\s{2,}/g, ' ');
  return plain || 'Tus documentos';
}

export function customerLocation(value: string): string {
  if (/\$\.|\b(?:fragment|region|bbox|object|scene|material|metadata)[_:[.]/i.test(value)) {
    const page = value.match(/(?:p[aá]gina|page)\s*[:=]?\s*(\d+)/i);
    return page ? `Página ${page[1]}` : '';
  }
  return customerText(value);
}
