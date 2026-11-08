import { str } from './content';
import { formatFromUrl, imageDimensionErrors, imageFileErrors } from './imageRules';
import type { AplusImage, ImageDimensions } from './types';

/**
 * «Datos del ecosistema» que Uony usa para generar contenido y sugerir imágenes
 * (TextOverlayModule.tsx 52-78 y 234-374). El original esperaba variables globales
 * que nunca se asignaban y usaba datos fijos; aquí salen del producto abierto: su
 * ficha, sus campos confirmados (Atributos) y su galería (Imágenes), como promete
 * el texto de la pestaña.
 */
export interface EcosystemField {
  name: string;
  value: string;
  type: string;
  isConfirmed: boolean;
}

export interface EcosystemImage {
  id: string;
  name: string;
  url: string;
  source: string;
  dimensions?: ImageDimensions;
  size?: number;
  format?: string;
}

export interface EcosystemSources {
  product: Record<string, unknown>;
  customFields: EcosystemField[];
  uploadedImages: EcosystemImage[];
  scrapedImages: EcosystemImage[];
}

export interface EcosystemData {
  name: string;
  sku: string;
  brand: string;
  category: string;
  description: string;
  price: string;
  customAttributes: EcosystemField[];
  availableImages: EcosystemImage[];
}

const asObjects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];

function readDimensions(value: unknown): ImageDimensions | undefined {
  const dims = value as { width?: unknown; height?: unknown } | null | undefined;
  const width = Number(dims?.width);
  const height = Number(dims?.height);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function readImages(list: unknown, source: string): EcosystemImage[] {
  const raw = Array.isArray(list) ? list : [];
  return raw.flatMap((item, index): EcosystemImage[] => {
    if (typeof item === 'string') return item ? [{ id: String(index + 1), name: `Imagen ${index + 1}`, url: item, source }] : [];
    const image = item as Record<string, unknown> | null;
    const url = str(image?.url || image?.src);
    if (!image || !url) return [];
    const size = Number(image.size);
    return [{
      id: str(image.id) || String(index + 1),
      name: str(image.name || image.alt) || `Imagen ${index + 1}`,
      url,
      source: str(image.source) || source,
      dimensions: readDimensions(image.dimensions),
      size: size > 0 ? size : undefined,
      format: str(image.format || image.type) || undefined,
    }];
  });
}

/** Reúne las fuentes: producto (con ediciones), porción customFields y porción images. */
export function readEcosystemSources(draft: Record<string, unknown> | null | undefined, customFieldsSlice: unknown, imagesSlice: unknown): EcosystemSources {
  const product = draft || {};
  const fields = asObjects(Array.isArray(customFieldsSlice) ? customFieldsSlice : product.customFields).map(field => ({
    name: str(field.name),
    value: Array.isArray(field.value) ? field.value.map(str).join(', ') : str(field.value),
    type: str(field.type) || 'text',
    isConfirmed: field.isConfirmed === true,
  }));
  let uploadedImages = readImages(imagesSlice, 'upload');
  if (!uploadedImages.length) uploadedImages = readImages(product.images, 'upload');
  if (!uploadedImages.length && str(product.image)) uploadedImages = readImages([product.image], 'upload');
  return { product, customFields: fields, uploadedImages, scrapedImages: [] };
}

// getProductEcosystemData (TextOverlayModule.tsx 234-256)
export function getProductEcosystemData(headline: string, sources: EcosystemSources): EcosystemData {
  const { product, customFields, uploadedImages, scrapedImages } = sources;
  return {
    name: headline || str(product.name) || 'Producto Innovador',
    sku: str(product.sku) || 'PROD-001',
    brand: str(product.brand) || 'Uonify',
    category: str(product.category) || 'Tecnología',
    description: str(product.description),
    price: str(product.price),
    customAttributes: customFields.filter(field => field && field.isConfirmed),
    availableImages: uploadedImages.concat(scrapedImages),
  };
}

/**
 * suggestImageFromEcosystem (TextOverlayModule.tsx 346-374): la primera imagen de
 * la galería. Sus medidas y su peso reales, si se conocen, se validan con las
 * normas A+; si no, las del original (970×300, 1 MB).
 */
export function buildSuggestedImage(data: EcosystemData, minWidth: number, minHeight: number): AplusImage | null {
  const suggested = data.availableImages[0];
  if (!suggested) return null;
  const dimensions = suggested.dimensions ?? { width: 970, height: 300 };
  const size = suggested.size ?? 1024 * 1024;
  const format = suggested.format || formatFromUrl(suggested.url);
  const validationErrors = [...imageFileErrors(format, size), ...imageDimensionErrors(dimensions, minWidth, minHeight)];
  return {
    id: `ecosystem-${suggested.id}`,
    url: suggested.url,
    file: null,
    altText: `Imagen del producto ${data.name}`,
    dimensions,
    size,
    format,
    isValid: validationErrors.length === 0,
    validationErrors,
  };
}

/** Datos del producto que viajan a POST /ai-aplus. */
export interface GenerateProductInfo {
  name: string;
  sku: string;
  brand: string;
  category: string;
  description: string;
  price: string;
  custom_attributes: { name: string; value: string; type: string }[];
  image_count: number;
}

export function toGenerateProductInfo(data: EcosystemData): GenerateProductInfo {
  return {
    name: data.name,
    sku: data.sku,
    brand: data.brand,
    category: data.category,
    description: data.description,
    price: data.price,
    custom_attributes: data.customAttributes.map(({ name, value, type }) => ({ name, value, type })),
    image_count: data.availableImages.length,
  };
}
