/**
 * Tipos de la pestaña «Auditoría IA» (prototipo: pim/auditoria.js).
 * La porción `audit` del almacén por producto guarda un `AuditState`.
 */

/** Tipo de un campo del esquema de Uonify. */
export type SchemaFieldType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface SchemaField {
  type: SchemaFieldType;
  description?: string;
  unit?: string;
  options?: string[];
}

/** Esquema de una categoría: campos requeridos, opcionales y su definición. */
export interface UonifySchema {
  required: string[];
  optional: string[];
  fields: Record<string, SchemaField>;
}

/** Estado de validación de un campo del esquema. */
export type FieldValidation = 'valid' | 'review' | 'missing';

/** Valores editables (claves del esquema o del scraper → valor). */
export type FieldMap = Record<string, unknown>;

/**
 * Respuesta de POST /ai-audit. Se lee siempre a la defensiva (A04): un 2xx sin
 * `ai_audit`, `audit_scores` o listas se pinta con valores vacíos.
 */
export interface AuditResult {
  detected_category?: unknown;
  amazon_product_type?: {
    name?: unknown;
    required_attributes?: unknown;
    optional_attributes?: unknown;
  } | null;
  ai_audit?: {
    amazon_attributes?: unknown;
    missing_required_attributes?: unknown;
    missing_optional_attributes?: unknown;
    recommendations?: unknown;
    audit_scores?: { amazon_readiness?: unknown; overall_score?: unknown } | null;
  } | null;
  [key: string]: unknown;
}

/** Respuesta del servicio de extracción (scraper) de producto. */
export interface ScrapedProduct {
  title?: string;
  sku?: string;
  ean?: string;
  brand?: string;
  price?: number | string;
  description?: string;
  long_description?: string;
  dimensions?: Record<string, unknown> | null;
  specifications?: Record<string, unknown> | null;
  suggested_category?: string;
  images?: string[];
  error?: string;
  [key: string]: unknown;
}

/** Porción `audit` del almacén (defaultProductState.audit del original). */
export interface AuditState {
  auditUrl: string;
  isScrapingActive: boolean;
  scrapingProgress: number;
  scrapedData: FieldMap | null;
  documentFiles: unknown[];
  analyzingDocs: boolean;
  analysisProgress: number;
  productSchema: unknown;
  mappedFields: FieldMap;
  scrapingError: string | null;
  suggestedCategory: string | null;
  isCategoryConfirmed: boolean | null;
  selectedCategory: string;
  uonifySchema: UonifySchema | null;
  fieldValidations: Record<string, FieldValidation>;
  editableFields: FieldMap;
  showSchemaComparison: boolean;
  missingFields: string[];
  completionProgress: number;
  auditResult: AuditResult | null;
  amazonAttributes: FieldMap;
}

/** Campo personalizado de la ficha (porción `customFields`, la que edita Atributos). */
export interface CustomField {
  id: string;
  name: string;
  type: string;
  value: unknown;
  options: string[];
  isConfirmed: boolean;
  source?: string;
}

/** Imagen que la auditoría añade a la galería (porción `images`). */
export interface ScrapedImage {
  id: string;
  url: string;
  file: null;
  source: 'scraped';
}

/** Vista con la acción sólida (solo presentación): una por pantalla. */
export type PrimaryOwner = 'schema' | 'suggestion' | 'selector' | 'attributes' | 'audit';
