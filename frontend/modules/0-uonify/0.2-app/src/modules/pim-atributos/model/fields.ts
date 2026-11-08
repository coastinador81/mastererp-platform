import type { CustomField, FieldType } from './types';

/**
 * Textos y reglas de presentación de la pestaña Atributos (prototipo:
 * pim/atributos.js, `T`, FIELD_TYPES, TYPE_ICON, isTechnicalValue, showsFieldAI).
 */
export const T = {
  productInformation: 'Información del Producto',
  customFields: 'Campos Personalizados',
  addCustomField: 'Agregar Campo Personalizado',
  fieldAdded: 'Confirmado',
  editField: 'Editar',
  fieldName: 'Nombre del Campo',
  fieldType: 'Tipo de Campo',
  fieldValue: 'Valor',
  selectOptions: 'Opciones (separadas por coma)',
  confirmField: 'Confirmar Campo',
  saveAndCreate: 'Crear Producto',
} as const;

export const FIELD_TYPES: ReadonlyArray<readonly [FieldType, string]> = [
  ['text', 'Texto'],
  ['number', 'Número'],
  ['textarea', 'Texto Largo'],
  ['select', 'Selección'],
  ['checkbox', 'Checkbox'],
  ['date', 'Fecha'],
];

export function typeLabel(type: string): string {
  return FIELD_TYPES.find(([value]) => value === type)?.[1] ?? type;
}

/** getFieldTypeIcon (ProductsPIMInterface.tsx) / FieldTypeIcon.tsx. */
export const TYPE_ICON: Record<string, string> = {
  text: 'type',
  number: 'hash',
  textarea: 'file-text',
  select: 'chevron-down',
  checkbox: 'check',
  date: 'calendar',
};

export function fieldTypeIconName(type: string): string {
  return TYPE_ICON[type] ?? 'type';
}

/** Clase del icono de tipo (pim-atributos-ft-<tipo> u -other si no es conocido). */
export function fieldTypeIconClass(type: string): string {
  return `pim-atributos-ft pim-atributos-ft-${TYPE_ICON[type] ? type : 'other'}`;
}

// Solo presentación: identificadores, códigos, medidas y URLs en monoespaciada.
const TECHNICAL_FIELD = /^(asin|ean|upc|gtin|isbn|sku|mpn|alto|ancho|profundidad)$/i;

export function isTechnicalValue(name: unknown, value: unknown): boolean {
  return TECHNICAL_FIELD.test(String(name ?? '').trim()) || /^https?:\/\//i.test(String(value ?? ''));
}

/** El botón «IA» del nombre de un campo solo aparece en campos de nombre o título. */
export function showsFieldAI(name: unknown): boolean {
  const lower = String(name || '').toLowerCase();
  return lower.includes('nombre') || lower.includes('title') || lower.includes('título');
}

export const hasUnconfirmed = (fields: CustomField[]): boolean => fields.some(field => !field.isConfirmed);

/** Texto que enseña la fila de un campo confirmado. */
export function shownValue(field: CustomField, isNew: boolean): string {
  if (field.type === 'checkbox') return field.value ? 'Sí' : 'No';
  if (isNew && field.type === 'select') return String(field.value ?? '');
  return String(field.value || 'Sin valor');
}

/** Valor como texto para un control de texto (un booleano o un vacío es ''). */
export function fieldText(value: CustomField['value']): string {
  return value === undefined || value === null || typeof value === 'boolean' ? '' : String(value);
}

/** Las opciones se derivan de lo tecleado (E16: el texto se queda tal cual). */
export function parseOptions(text: string): string[] {
  return text.split(',').map(option => option.trim()).filter(Boolean);
}

/** Campo nuevo con un id que no repite ninguno de la lista. */
export function createField(fields: CustomField[], now = Date.now()): CustomField {
  let stamp = now;
  while (fields.some(field => field.id === `field-${stamp}`)) stamp += 1;
  return { id: `field-${stamp}`, name: '', type: 'text', value: '', options: [], isConfirmed: false };
}
