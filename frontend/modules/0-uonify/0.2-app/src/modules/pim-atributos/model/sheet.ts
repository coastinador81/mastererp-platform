import type { PimEdited, PimProduct, PimTabContext } from '@/shared/pim';

/**
 * ¿La ficha sigue enseñando este producto? Un guardado o una respuesta de stock
 * pueden llegar cuando la persona ya cambió de pestaña o de producto
 * (prototipo: pim/atributos.js, sheetShowsThisProduct).
 */
export function sheetShowsProduct(ctx: PimTabContext, product: PimProduct | null, mounted: boolean): boolean {
  if (mounted) return true;
  if (ctx.isNew || !product) return false;
  try {
    const edited = ctx.store.get<PimEdited>('edited', {}) || {};
    return (ctx.draft() as PimEdited | null)?.sku === (edited.sku ?? product.sku);
  } catch {
    return false;
  }
}

/** Selector de atributo con el valor entre comillas escapado (ids de campo con cualquier carácter). */
export function attrSelector(attr: string, value: string, extra = ''): string {
  return `${extra}[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}
