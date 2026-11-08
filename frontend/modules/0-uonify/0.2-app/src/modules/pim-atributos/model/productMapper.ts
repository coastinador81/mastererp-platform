import { MARKETPLACE } from '@/shared/pim';
import type { ProductLike } from './types';

/**
 * Mapeadores de producto (prototipo: pim/atributos.js; original:
 * utils/productMapper.ts y hooks/useProductUpdate.ts). Lógica pura: reciben el
 * producto y devuelven el cuerpo que espera cada endpoint.
 */

export const SELLER_ID = '1Y6J8';
export const MARKETPLACE_ID = MARKETPLACE.id;
export const COUNTRY_CODE = MARKETPLACE.countryCode;
export const LANGUAGE_TAG = 'es_ES';

type Metafield = { namespace: 'custom'; key: string; value: string; type: string };
type Row = readonly [from: string, key: string, type: string];

const TECHNICAL_FIELDS: Row[] = [
  ['model', 'modelo_del_producto', 'single_line_text_field'], ['weight', 'peso_neto', 'number_decimal'],
  ['height', 'altura_neta', 'number_decimal'], ['width', 'anchura_neta', 'number_decimal'],
  ['depth', 'profundidad_neta', 'number_decimal'], ['capacity', 'capacidad_bruta_litros', 'number_decimal'],
  ['fridge_capacity', 'capacidad_bruta_frigorifico_litros', 'number_decimal'],
  ['freezer_capacity', 'capacidad_bruta_congelador_litros', 'number_decimal'],
  ['energy_label', 'etiqueta_de_eficiencia_energetica', 'single_line_text_field'],
  ['cooling_type', 'tipo_de_refrigeracion', 'single_line_text_field'], ['technical_name', 'nombre_tecnico', 'single_line_text_field'],
  ['shipping_method', 'metodo_de_envio', 'single_line_text_field'], ['ships_from', 'envio_desde', 'single_line_text_field'],
];
const INTERNAL_FIELDS: Row[] = [
  ['model', 'modelo_del_producto', 'single_line_text_field'], ['weight', 'peso_neto', 'number_decimal'],
  ['height', 'altura_neta', 'number_decimal'], ['width', 'anchura_neta', 'number_decimal'],
  ['depth', 'profundidad_neta', 'number_decimal'], ['technical_name', 'nombre_tecnico', 'single_line_text_field'],
  ['shipping_method', 'metodo_de_envio', 'single_line_text_field'], ['ships_from', 'envio_desde', 'single_line_text_field'],
];

const filled = (value: unknown) => value !== undefined && value !== null && value !== '';
const str = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const handleOf = (text: unknown) => str(text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const tagsOf = (keywords: unknown) => (Array.isArray(keywords) ? keywords.join(', ') : typeof keywords === 'string' ? keywords : '');
const priceOf = (product: ProductLike) => str(product.retail_price || product.price) || '0.00';

/** Viñetas con texto, como máximo cinco (Amazon admite cinco bullet_point). */
export function amazonBullets(bullets: unknown): string[] {
  return list(bullets).filter(bullet => bullet && String(bullet).trim()).slice(0, 5).map(String);
}

export function mapAmazonToShopify(product: ProductLike) {
  const bullets = list(product.bullet_points);
  let bodyHtml = str(product.description);
  if (bullets.length > 0) bodyHtml = `<p>${str(product.description)}</p><ul>${bullets.map(point => `<li>${str(point)}</li>`).join('')}</ul>`;
  const metafields: Metafield[] = [];
  if (product.asin) metafields.push({ namespace: 'custom', key: 'link_de_amazon', value: `https://www.amazon.es/dp/${str(product.asin)}`, type: 'url' });
  bullets.forEach((bullet, index) => {
    if (index < 5) metafields.push({ namespace: 'custom', key: `vineta${index + 1}`, value: str(bullet), type: 'multi_line_text_field' });
  });
  TECHNICAL_FIELDS.forEach(([from, key, type]) => {
    if (filled(product[from])) metafields.push({ namespace: 'custom', key, value: str(product[from]), type });
  });
  if (product.product_sheet_url) metafields.push({ namespace: 'custom', key: 'ficha_de_producto', value: str(product.product_sheet_url), type: 'url' });
  if (product.energy_sheet_jpg_url) metafields.push({ namespace: 'custom', key: 'ficha_de_eficiencia_energetica_jpg', value: str(product.energy_sheet_jpg_url), type: 'url' });
  if (product.user_manual_url) metafields.push({ namespace: 'custom', key: 'manual_de_usuario', value: str(product.user_manual_url), type: 'url' });
  const images = Array.isArray(product.images) ? product.images.map(url => ({ src: url })) : product.image ? [{ src: product.image }] : [];
  return {
    title: str(product.name || product.title) || `Producto ${str(product.sku)}`,
    body_html: bodyHtml,
    vendor: str(product.brand || product.vendor) || 'Amazon',
    product_type: str(product.category || product.productType) || 'General',
    handle: handleOf(product.sku),
    tags: tagsOf(product.keywords),
    status: 'draft',
    variants: [{ sku: product.sku, price: priceOf(product), inventory_quantity: product.stock || 0, inventory_management: 'shopify' }],
    images,
    metafields,
  };
}

export function mapInternalToShopify(product: ProductLike) {
  const metafields: Metafield[] = [];
  list(product.bullet_points).forEach((bullet, index) => {
    if (index < 5 && bullet && String(bullet).trim()) metafields.push({ namespace: 'custom', key: `vineta${index + 1}`, value: String(bullet).trim(), type: 'multi_line_text_field' });
  });
  INTERNAL_FIELDS.forEach(([from, key, type]) => {
    if (filled(product[from])) metafields.push({ namespace: 'custom', key, value: str(product[from]), type });
  });
  const isHttp = (src: unknown): src is string => typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://'));
  let validImages = list(product.images)
    .map(img => (typeof img === 'string' ? img : (img as { src?: unknown } | null)?.src))
    .filter(isHttp)
    .map(src => ({ src }));
  if (isHttp(product.image)) validImages = [{ src: product.image }, ...validImages];
  validImages = validImages.slice(0, 5);
  return {
    title: product.name || product.title,
    body_html: str(product.description || product.body_html),
    vendor: str(product.brand || product.vendor) || 'Uonify',
    product_type: str(product.category || product.productType) || 'General',
    handle: handleOf(product.sku || product.name),
    tags: product.tags || tagsOf(product.keywords),
    status: 'draft',
    variants: [{ sku: product.sku, price: priceOf(product), inventory_quantity: parseInt(str(product.stock) || '0', 10) || 0, inventory_management: 'shopify' }],
    images: validImages,
    metafields: metafields.length > 0 ? metafields : undefined,
  };
}

type GpsrLike = Record<string, unknown> | null | undefined;

/** Datos GPSR del producto (pestaña GPSR) en el formato de la Listings API. */
export function gpsrFields(product: ProductLike, storedGpsr?: GpsrLike): Record<string, unknown> {
  const gpsr = ((product.gpsr && typeof product.gpsr === 'object' ? product.gpsr : storedGpsr) || {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (gpsr.compliance_document_url) {
    fields.new_source_location = gpsr.compliance_document_url;
    fields.content_type = gpsr.content_type || 'user_manual';
    fields.content_language = gpsr.content_language || LANGUAGE_TAG;
  }
  if (gpsr.manufacturer_contact) fields.gpsr_manufacturer_reference = gpsr.manufacturer_contact;
  if (gpsr.eu_responsible_address) fields.dsa_responsible_party_address = gpsr.eu_responsible_address;
  if (gpsr.safety_attestation === true) fields.gpsr_safety_attestation_value = true;
  return fields;
}

/**
 * Crear un listing (mapInternalToAmazon). El mapeador original llevaba datos de
 * cumplimiento de ejemplo; en un anuncio real declararían datos falsos, así que
 * solo va el GPSR del propio producto (y nada si está vacío).
 */
export function mapInternalToAmazon(product: ProductLike, storedGpsr?: GpsrLike, sellerId = SELLER_ID) {
  let bulletPoints = amazonBullets(product.bullet_points);
  if (bulletPoints.length === 0) bulletPoints = [str(product.description || product.name) || 'Producto sin descripción'];
  return {
    sku: product.sku,
    seller_id: sellerId,
    marketplace_id: MARKETPLACE_ID,
    product_type: str(product.productType) || 'PRODUCT',
    country_code: COUNTRY_CODE,
    item_name: product.name || product.title,
    bullet_points: bulletPoints,
    product_description_html: str(product.description),
    brand: str(product.brand || product.vendor) || 'Generic',
    generic_keyword: product.keywords || '',
    ...gpsrFields(product, storedGpsr),
    ships_globally_value: false,
    price: product.retail_price || product.price,
    images: Array.isArray(product.images) ? product.images : [],
  };
}

/** Actualizar un listing existente (useProductUpdate.updateAmazonListing). */
export function amazonUpdatePayload(sku: unknown, data: ProductLike) {
  const bulletPoints = amazonBullets(data.bullet_points);
  const attributes: Record<string, Array<{ value: unknown; language_tag: string }>> = {};
  if (data.name) attributes.item_name = [{ value: data.name, language_tag: LANGUAGE_TAG }];
  if (bulletPoints.length > 0) attributes.bullet_point = bulletPoints.map(value => ({ value, language_tag: LANGUAGE_TAG }));
  if (data.description) attributes.product_description = [{ value: data.description, language_tag: LANGUAGE_TAG }];
  const payload: Record<string, unknown> = {
    sku,
    seller_id: SELLER_ID,
    marketplace_id: MARKETPLACE_ID,
    product_type: str(data.productType || data.product_type) || 'LUGGAGE',
    country_code: COUNTRY_CODE,
    attributes,
  };
  if (Array.isArray(data.images) && data.images.length > 0) payload.images = data.images.slice(0, 9);
  return payload;
}

/** Si el producto ya tiene listing en Amazon (se actualiza) o hay que crearlo. */
export const isAmazonListed = (product: ProductLike) => Boolean(product.amazon_id) || product.source === 'amazon';
