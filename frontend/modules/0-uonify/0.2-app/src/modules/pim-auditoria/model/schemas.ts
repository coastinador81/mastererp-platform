import type { AuditState, UonifySchema } from './types';
import { own } from './translations';

/**
 * Categorías y esquemas de Uonify (ProductsPIMInterface.tsx 461-542 del original)
 * y estado inicial de la porción `audit` (hooks/useProductState.ts).
 */
export const UONIFY_CATEGORIES = [
  'Frigorífico Combi', 'Televisor', 'Smartphone', 'Lavadora', 'Auriculares', 'Tablet', 'Microondas', 'Aspiradora', 'Portátil', 'Cafetera',
] as const;

export const UONIFY_SCHEMAS: Record<string, UonifySchema> = {
  'Frigorífico Combi': {
    required: ['nombre', 'marca', 'modelo', 'capacidad_total', 'eficiencia_energetica', 'precio'],
    optional: ['color', 'dimensiones', 'peso', 'tecnologia_no_frost', 'dispensador_agua', 'tipo_congelador'],
    fields: {
      nombre: { type: 'text', description: 'Nombre comercial del producto' },
      marca: { type: 'text', description: 'Marca del fabricante' },
      modelo: { type: 'text', description: 'Número de modelo' },
      capacidad_total: { type: 'number', description: 'Capacidad total en litros', unit: 'L' },
      eficiencia_energetica: { type: 'select', options: ['A+++', 'A++', 'A+', 'A', 'B', 'C', 'D'] },
      precio: { type: 'number', description: 'Precio de venta', unit: '€' },
      color: { type: 'text', description: 'Color principal' },
      dimensiones: { type: 'text', description: 'Alto x Ancho x Profundo en cm' },
      peso: { type: 'number', description: 'Peso en kg', unit: 'kg' },
      tecnologia_no_frost: { type: 'boolean', description: 'Incluye tecnología No Frost' },
      dispensador_agua: { type: 'boolean', description: 'Tiene dispensador de agua' },
      tipo_congelador: { type: 'select', options: ['Inferior', 'Superior', 'Side by Side'] },
    },
  },
  Televisor: {
    required: ['nombre', 'marca', 'tamaño_pantalla', 'resolucion', 'precio'],
    optional: ['tecnologia_display', 'smart_tv', 'hdr', 'refresh_rate', 'conectividad'],
    fields: {
      nombre: { type: 'text', description: 'Nombre comercial del producto' },
      marca: { type: 'text', description: 'Marca del fabricante' },
      tamaño_pantalla: { type: 'number', description: 'Tamaño en pulgadas', unit: '"' },
      resolucion: { type: 'select', options: ['4K UHD', 'Full HD', '8K', 'HD Ready'] },
      precio: { type: 'number', description: 'Precio de venta', unit: '€' },
      tecnologia_display: { type: 'select', options: ['LED', 'OLED', 'QLED', 'LCD'] },
      smart_tv: { type: 'boolean', description: 'Es Smart TV' },
      hdr: { type: 'boolean', description: 'Soporte HDR' },
      refresh_rate: { type: 'number', description: 'Frecuencia de actualización', unit: 'Hz' },
      conectividad: { type: 'text', description: 'Puertos y conectividad disponible' },
    },
  },
  Smartphone: {
    required: ['nombre', 'marca', 'modelo', 'almacenamiento', 'precio'],
    optional: ['ram', 'pantalla_tamaño', 'camara_principal', 'bateria', 'sistema_operativo', 'color'],
    fields: {
      nombre: { type: 'text', description: 'Nombre comercial del producto' },
      marca: { type: 'text', description: 'Marca del fabricante' },
      modelo: { type: 'text', description: 'Número de modelo' },
      almacenamiento: { type: 'select', options: ['64GB', '128GB', '256GB', '512GB', '1TB'] },
      precio: { type: 'number', description: 'Precio de venta', unit: '€' },
      ram: { type: 'select', options: ['4GB', '6GB', '8GB', '12GB', '16GB'] },
      pantalla_tamaño: { type: 'number', description: 'Tamaño de pantalla en pulgadas', unit: '"' },
      camara_principal: { type: 'number', description: 'Megapíxeles cámara principal', unit: 'MP' },
      bateria: { type: 'number', description: 'Capacidad de batería', unit: 'mAh' },
      sistema_operativo: { type: 'select', options: ['iOS', 'Android'] },
      color: { type: 'text', description: 'Color disponible' },
    },
  },
  General: {
    required: ['nombre', 'marca', 'precio'],
    optional: ['modelo', 'sku', 'ean', 'descripcion', 'color', 'peso', 'dimensiones'],
    fields: {
      nombre: { type: 'text', description: 'Nombre comercial del producto' },
      marca: { type: 'text', description: 'Marca del fabricante' },
      precio: { type: 'number', description: 'Precio de venta', unit: '€' },
      modelo: { type: 'text', description: 'Número de modelo' },
      sku: { type: 'text', description: 'Código SKU' },
      ean: { type: 'text', description: 'Código EAN/GTIN' },
      descripcion: { type: 'text', description: 'Descripción del producto' },
      color: { type: 'text', description: 'Color principal' },
      peso: { type: 'number', description: 'Peso', unit: 'kg' },
      dimensiones: { type: 'text', description: 'Dimensiones del producto' },
    },
  },
};

/**
 * Esquema de una categoría. Una categoría sin esquema propio (p. ej. «Lavadora» o la
 * que sugiere el backend) carga el esquema 'General' en lugar de dejar el flujo sin salida (E18/E19).
 */
export function schemaFor(category: string): UonifySchema {
  return own(UONIFY_SCHEMAS, category) ?? UONIFY_SCHEMAS.General;
}

export const DEFAULT_AUDIT: AuditState = {
  auditUrl: '', isScrapingActive: false, scrapingProgress: 0, scrapedData: null, documentFiles: [], analyzingDocs: false,
  analysisProgress: 0, productSchema: null, mappedFields: {}, scrapingError: null, suggestedCategory: null,
  isCategoryConfirmed: null, selectedCategory: '', uonifySchema: null, fieldValidations: {}, editableFields: {},
  showSchemaComparison: false, missingFields: [], completionProgress: 0, auditResult: null, amazonAttributes: {},
};

/** La porción guardada completada con los valores por defecto. */
export function withDefaults(stored: unknown): AuditState {
  return { ...DEFAULT_AUDIT, ...(stored && typeof stored === 'object' ? (stored as Partial<AuditState>) : {}) };
}

/** Parche de resetAuditData (auditResult y amazonAttributes se quedan, como el original). */
export const RESET_AUDIT_PATCH: Partial<AuditState> = {
  auditUrl: '', scrapedData: null, mappedFields: {}, documentFiles: [], scrapingError: null, scrapingProgress: 0,
  analysisProgress: 0, suggestedCategory: null, isCategoryConfirmed: null, selectedCategory: '', uonifySchema: null,
  fieldValidations: {}, editableFields: {}, showSchemaComparison: false, missingFields: [], completionProgress: 0,
};

/** Los cuatro pasos de las instrucciones del original (E03), literales. */
export const STEPS: ReadonlyArray<readonly [string, string]> = [
  ['Analiza', 'Pega la URL del producto'],
  ['Categoriza', 'Confirma o selecciona la categoría'],
  ['Valida', 'Revisa y edita los campos extraídos'],
  ['Aplica', 'Transfiere los datos validados al producto'],
];

/** Texto de estado de un campo del esquema (SchemaComparisonSection). */
export const STATUS_TEXT: Record<string, string> = { valid: '✓ Válido', review: '⚠ Revisar', missing: '✗ Faltante' };

/** Tipos del formulario «Agregar Campo Personalizado». */
export const NEW_FIELD_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['text', 'Texto'], ['number', 'Número'], ['textarea', 'Texto largo'], ['select', 'Lista de opciones'], ['checkbox', 'Sí/No'], ['date', 'Fecha'],
];
