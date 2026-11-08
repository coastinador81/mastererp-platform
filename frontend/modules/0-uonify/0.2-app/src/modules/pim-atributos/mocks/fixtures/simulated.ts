import { PRODUCT_TYPES } from './productTypes';

/**
 * Respuestas generadas por la simulación: el título de Uony (POST /bullet-point)
 * y los avisos que Amazon devuelve al recibir un listing (PUT /amazon/products).
 */

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** Nombre visible de una categoría técnica (TOY_FIGURE → «Figura de juguete»). */
function categoryLabel(category: string): string {
  const known = PRODUCT_TYPES.find(type => type.name === category.toUpperCase());
  if (known) return known.displayName;
  return /^[A-Z0-9_]+$/.test(category) ? capitalize(category.toLowerCase().replace(/_/g, ' ')) : category;
}

/** Título al estilo Amazon: marca + nombre + categoría + beneficio, como máximo 200 caracteres. */
export function simulatedTitle(input: { product_name?: unknown; brand?: unknown; category?: unknown }): string {
  const name = capitalize(clean(input.product_name) || 'Producto');
  const brand = clean(input.brand);
  const category = categoryLabel(clean(input.category));
  let title = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
  if (category && !title.toLowerCase().includes(category.toLowerCase())) title += ` – ${category}`;
  title += ', diseño resistente y fácil de usar';
  return title.length > 200 ? `${title.slice(0, 197).trimEnd()}…` : title;
}

export interface SimulatedIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  attributeName: string;
}

/** Lo que Amazon revisa al recibir un listing: errores (INVALID) y recomendaciones (WARNING). */
export function listingIssues(body: Record<string, unknown>): SimulatedIssue[] {
  const issues: SimulatedIssue[] = [];
  if (!clean(body.sku)) {
    issues.push({ code: '4000001', severity: 'ERROR', message: 'Falta el SKU del vendedor.', attributeName: 'sku' });
    return issues;
  }
  const attributes = (body.attributes ?? {}) as Record<string, unknown[] | undefined>;
  const isUpdate = Boolean(body.attributes);
  const bullets = isUpdate ? (attributes.bullet_point ?? []).length : (Array.isArray(body.bullet_points) ? body.bullet_points.length : 0);
  const images = Array.isArray(body.images) ? body.images.length : 0;
  if (!isUpdate && !clean(body.item_name)) {
    issues.push({ code: '90220', severity: 'ERROR', message: 'Falta el título del producto (item_name).', attributeName: 'item_name' });
  }
  if (bullets > 0 && bullets < 5) {
    issues.push({ code: '99022', severity: 'WARNING', message: `Amazon recomienda cinco viñetas; el anuncio tiene ${bullets}.`, attributeName: 'bullet_point' });
  }
  if (!isUpdate && images === 0) {
    issues.push({ code: '90244', severity: 'WARNING', message: 'Añade una imagen principal para que el anuncio se muestre en la búsqueda.', attributeName: 'main_product_image_locator' });
  }
  return issues;
}
