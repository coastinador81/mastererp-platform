import type { CustomField, FieldMap, ScrapedImage, UonifySchema } from './types';
import { own } from './translations';
import { customFieldType } from './validation';

/**
 * Paso «4. Aplica» y gestión de campos (handleApplyMappedData, handleFieldMove,
 * handleAddFieldFromManager del original), como funciones puras.
 */

/** Claves que van a los campos básicos del producto abierto (E28: 'descripcion' incluida). */
export const BASIC_FIELD_MAPPING: Record<string, string> = {
  'título': 'name', nombre: 'name', sku: 'sku', marca: 'brand', 'categoría': 'category',
  'descripción': 'description', descripcion: 'description', precio: 'price',
};

const BASIC_FIELDS = [...Object.keys(BASIC_FIELD_MAPPING), 'images', 'category', 'title', 'brand', 'description', 'price', 'sku'];

export interface ApplyMappedPlan {
  /** Imágenes extraídas que se añaden a la galería. */
  images: ScrapedImage[];
  /** Mezcla para el producto abierto (ctx.edit). */
  productPatch: Record<string, string>;
  /** Campos personalizados nuevos (sustituyen a los existentes, como el original). */
  customFields: CustomField[];
  /** Nº de campos aplicados (para el aviso). */
  appliedCount: number;
}

/** handleApplyMappedData: reparte los campos entre galería, producto y campos personalizados. */
export function planApplyMapped(fieldsToApply: FieldMap, schema: UonifySchema | null, now = Date.now()): ApplyMappedPlan {
  const rawImages = fieldsToApply.images;
  const images: ScrapedImage[] = Array.isArray(rawImages) && rawImages.length > 0
    ? rawImages.map((url, index) => ({ id: `scraped-${now}-${index}`, url: String(url), file: null, source: 'scraped' }))
    : [];
  const productPatch: Record<string, string> = {};
  Object.entries(fieldsToApply).forEach(([key, value]) => {
    const productField = own(BASIC_FIELD_MAPPING, key.toLowerCase());
    if (productField && value) productPatch[productField] = String(value);
  });
  const customFields = Object.entries(fieldsToApply)
    .filter(([key, value]) => !BASIC_FIELDS.includes(key.toLowerCase()) && key !== 'images' && value !== '' && value !== null && value !== undefined && !Array.isArray(value))
    .map(([key, value]): CustomField => {
      const fieldSchema = schema ? own(schema.fields, key) : undefined;
      let fieldType = 'text';
      if (fieldSchema?.type) fieldType = customFieldType(fieldSchema.type);
      else if (typeof value === 'boolean') fieldType = 'checkbox';
      else if (!isNaN(Number(value)) && value !== '') fieldType = 'number';
      return {
        id: `field-${now}-${key}`,
        name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
        type: fieldType,
        value: fieldType === 'checkbox' ? Boolean(value) : String(value),
        options: fieldSchema?.options || [],
        isConfirmed: true,
      };
    });
  return { images, productPatch, customFields, appliedCount: Object.keys(fieldsToApply).length };
}

/** Valor inicial de un campo movido desde «Datos Faltantes». */
export const defaultValueFor = (type: string): unknown => (type === 'boolean' ? false : '');

export interface MovedFieldData {
  name: string;
  type: string;
  value: unknown;
  options: string[];
  description: string;
  unit: string;
  required: boolean;
}

/** Datos del campo que se suelta en la zona de gestión (handleFieldDrop). */
export function movedFieldData(fieldName: string, schema: UonifySchema | null): MovedFieldData {
  const fieldSchema = own(schema?.fields, fieldName);
  const type = fieldSchema?.type || 'text';
  return {
    name: fieldName.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()),
    type,
    value: defaultValueFor(type),
    options: fieldSchema?.options || [],
    description: fieldSchema?.description || '',
    unit: fieldSchema?.unit || '',
    required: schema?.required.includes(fieldName) || false,
  };
}

/** Campo personalizado sin confirmar creado al mover un campo (E22: boolean → checkbox). */
export function movedCustomField(fieldName: string, data: MovedFieldData, now = Date.now()): CustomField {
  return {
    id: `field-${now}-${fieldName}`,
    name: data.name,
    type: customFieldType(data.type),
    value: data.value,
    options: data.options || [],
    isConfirmed: false,
  };
}

/** Campo personalizado creado desde «Agregar Campo Personalizado». */
export function managerCustomField(fieldName: string, fieldValue: unknown, fieldType: string, now = Date.now()): CustomField {
  return {
    id: `field-${now}-${fieldName}`,
    name: fieldName.replace(/_/g, ' ').replace(/^./, str => str.toUpperCase()),
    type: fieldType,
    value: fieldType === 'checkbox' ? fieldValue === 'true' || fieldValue === true : fieldValue,
    options: [],
    isConfirmed: false,
  };
}

/** Clave de esquema a partir del nombre escrito («Garantía extendida» → «garantía_extendida»). */
export const fieldKeyFromName = (name: string): string => name.toLowerCase().replace(/\s+/g, '_');

/** Siguiente elemento que recibe el foco tras mover uno (el de después o el de antes). */
export function neighbourOf(list: string[], item: string): string | null {
  const index = list.indexOf(item);
  return list[index + 1] ?? list[index - 1] ?? null;
}
