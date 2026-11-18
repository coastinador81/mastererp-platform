export async function collectOffsetPages(fetchPage, pageSize = 100) {
  const items = [];
  const seen = new Set();
  let offset = 0;
  while (offset != null) {
    if (seen.has(offset)) throw new Error('La API repitió una página de resultados.');
    seen.add(offset);
    const page = await fetchPage(offset, pageSize);
    if (!Array.isArray(page?.items)) throw new Error('La API devolvió una página inválida.');
    items.push(...page.items);
    offset = Number.isInteger(page.next_offset) ? page.next_offset : null;
  }
  return items;
}

export async function collectCursorPages(fetchPage, pageSize = 100) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  do {
    if (cursor && seen.has(cursor)) throw new Error('La API repitió un cursor de resultados.');
    if (cursor) seen.add(cursor);
    const page = await fetchPage(cursor, pageSize);
    if (!Array.isArray(page?.items)) throw new Error('La API devolvió una página inválida.');
    items.push(...page.items);
    cursor = page.next_cursor || null;
  } while (cursor);
  return items;
}
