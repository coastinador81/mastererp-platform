/**
 * Tipos de la pestaña Atributos (prototipo: pim/atributos.js).
 * Los productos del catálogo son objetos abiertos (PimProduct): aquí solo se
 * nombran los campos que la pestaña lee o escribe.
 */

/** Tipos de campo personalizado (CustomFieldsEditMode.tsx del original). */
export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date';

/**
 * Campo personalizado (attributesManager.customFields del original). Vive en la
 * porción `customFields` del producto y lo comparten Atributos y Auditoría IA.
 */
export interface CustomField {
  id: string;
  name: string;
  /** Normalmente un FieldType; un valor desconocido se pinta como texto. */
  type: FieldType | string;
  value: string | number | boolean | null | undefined;
  options: string[];
  isConfirmed: boolean;
}

/** Categoría (product type) de Amazon devuelta por la búsqueda. */
export interface CategoryOption {
  name: string;
  displayName?: string;
}

/** Estado de stock de un producto (StockSelector.tsx: amazon_vendor.available). */
export interface StockData {
  amazon_vendor?: { available?: boolean; qty_on_hand?: number; [field: string]: unknown };
  [field: string]: unknown;
}

/** Término del buscador de categorías, válido mientras la categoría sea `forCategory`. */
export interface CategoryTerm {
  term: string;
  forCategory: string;
}

/** Producto tal como lo leen los mapeadores (campos opcionales y abiertos). */
export interface ProductLike {
  sku?: string;
  name?: string;
  title?: string;
  [field: string]: unknown;
}

/** Aviso de Amazon en la respuesta de un listing. */
export interface AmazonIssue {
  code?: string;
  message?: string;
  severity?: string;
  attributeName?: string;
  [field: string]: unknown;
}

/** Respuesta de Amazon (Listings API) tras crear o actualizar un listing. */
export interface AmazonListingResponse {
  status?: string;
  issues?: AmazonIssue[];
  error?: string;
  statusCode?: number;
  submissionId?: string;
  [field: string]: unknown;
}
