import type { PublishCheck, PublishData } from '@/shared/pim';

/**
 * Revisión previa de Amazon.es (prototipo: canal «Amazon» de pim/publicar.js): lo
 * que Seller Central exige para crear la oferta (obligatorio: sin ello no se envía
 * ese producto) y lo que la ficha necesita para venderse bien (recomendado: se
 * avisa, pero se publica). `tab` lleva a la pestaña donde se completa.
 */
export const text = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const priceOf = (data: PublishData): number => Number(String(data.retail_price ?? data.price ?? '').replace(',', '.'));

const bulletsOf = (data: PublishData): unknown[] => {
  const list = Array.isArray(data.bullet_points) ? data.bullet_points : Array.isArray(data.bullets) ? (data.bullets as unknown[]) : [];
  return list.filter(bullet => text(bullet));
};

const imagesOf = (data: PublishData): string[] => (Array.isArray(data.images) ? (data.images as unknown[]) : [])
  .map(image => (typeof image === 'string' ? image : (image as { url?: string } | null)?.url))
  .filter((url): url is string => Boolean(url));

const fieldValue = (data: PublishData, pattern: RegExp): unknown => {
  const fields = Array.isArray(data.customFields) ? (data.customFields as Array<{ name?: unknown; value?: unknown } | null>) : [];
  return fields.find(field => pattern.test(String(field?.name || '')) && text(field?.value))?.value;
};

export function amazonChecks(data: PublishData): PublishCheck[] {
  const title = text(data.name || data.title);
  const gpsr = (data.gpsr || {}) as Record<string, unknown>;
  const pending = text(data.pendingSku);
  return [
    { label: 'Título', ok: Boolean(title) && title.length <= 200, required: true, tab: 'atributos', hint: title.length > 200 ? 'Máximo 200 caracteres' : 'Obligatorio' },
    { label: 'SKU', ok: Boolean(text(data.sku)) && !pending, required: true, tab: 'atributos', hint: pending ? `Guarda la ficha: el SKU ha cambiado a ${pending}` : 'Obligatorio' },
    { label: 'Marca', ok: Boolean(text(data.brand)), required: true, tab: 'atributos', hint: 'Obligatoria' },
    { label: 'Precio', ok: priceOf(data) > 0, required: true, tab: 'atributos', hint: 'Mayor que 0' },
    { label: 'Imagen principal', ok: imagesOf(data).length > 0, required: true, tab: 'imagenes', hint: 'Al menos una imagen' },
    { label: 'Descripción o viñetas', ok: Boolean(text(data.description)) || bulletsOf(data).length > 0, required: true, tab: 'descripciones', hint: 'Obligatorio' },
    { label: 'GPSR: contacto del fabricante', ok: Boolean(text(gpsr.manufacturer_contact)), required: true, tab: 'gpsr', hint: 'Exigido en la UE' },
    { label: 'GPSR: persona responsable en la UE', ok: Boolean(text(gpsr.eu_responsible_address)), required: true, tab: 'gpsr', hint: 'Exigido en la UE' },
    { label: 'Cinco viñetas', ok: bulletsOf(data).length >= 5, required: false, tab: 'descripciones', hint: 'Amazon muestra hasta cinco' },
    { label: 'Palabras clave', ok: Boolean(text(data.keywords)), required: false, tab: 'descripciones', hint: 'Mejoran la búsqueda' },
    { label: 'EAN o exención de GTIN', ok: Boolean(text(data.ean || fieldValue(data, /\b(ean|gtin|upc)\b/i))), required: false, tab: 'atributos', hint: 'Amazon lo pedirá al crear la oferta' },
  ];
}
