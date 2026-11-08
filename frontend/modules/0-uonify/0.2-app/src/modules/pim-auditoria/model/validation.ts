import type { AuditState, FieldMap, FieldValidation, PrimaryOwner, SchemaFieldType, UonifySchema } from './types';

/**
 * Validación del esquema y reglas de presentación (ProductsPIMInterface.tsx:
 * validateFields, getValidationIcon/Color; AuditoriaIATab: qué vista lleva la acción sólida).
 */

export interface SchemaValidation {
  fieldValidations: Record<string, FieldValidation>;
  missingFields: string[];
  completionProgress: number;
}

/**
 * validateFields(schema) del original, con los campos que debe validar (E20: usa los
 * valores recién escritos). El % cuenta solo campos del esquema (no pasa de 100).
 */
export function validateFields(schema: UonifySchema, fields: FieldMap): SchemaValidation {
  const validations: Record<string, FieldValidation> = {};
  const missing: string[] = [];
  const filled = (field: string) => Boolean(fields[field]) && fields[field] !== '';
  schema.required.forEach(field => {
    if (filled(field)) validations[field] = 'valid';
    else {
      validations[field] = 'missing';
      missing.push(field);
    }
  });
  schema.optional.forEach(field => { validations[field] = filled(field) ? 'valid' : 'review'; });
  Object.keys(fields).forEach(field => {
    if (!schema.required.includes(field) && !schema.optional.includes(field)) validations[field] = 'review';
  });
  const totalFields = schema.required.length + schema.optional.length;
  const completedFields = [...schema.required, ...schema.optional].filter(filled).length;
  return {
    fieldValidations: validations,
    missingFields: missing,
    completionProgress: totalFields ? Math.round((completedFields / totalFields) * 100) : 0,
  };
}

/** Parche de la porción con los campos nuevos y, si hay esquema, su validación. */
export function withValidation(audit: AuditState, editableFields: FieldMap): Partial<AuditState> {
  return audit.uonifySchema ? { editableFields, ...validateFields(audit.uonifySchema, editableFields) } : { editableFields };
}

/**
 * updateEditableField: el campo editado pasa a válido o faltante y se recalculan
 * faltantes y progreso (E27: el botón Aplicar se habilita al completar los requeridos).
 */
export function editFieldPatch(audit: AuditState, field: string, value: unknown): Partial<AuditState> {
  const editableFields = { ...audit.editableFields, [field]: value };
  if (!audit.uonifySchema) return { editableFields };
  const recalculated = validateFields(audit.uonifySchema, editableFields);
  return {
    editableFields,
    fieldValidations: { ...audit.fieldValidations, [field]: value && value !== '' ? 'valid' : 'missing' },
    missingFields: recalculated.missingFields,
    completionProgress: recalculated.completionProgress,
  };
}

/** Tipo del esquema → tipo de campo de Atributos (switch de handleApplyMappedData; E22: boolean → checkbox). */
export function customFieldType(schemaType: SchemaFieldType | string | undefined): string {
  switch (schemaType) {
    case 'number': return 'number';
    case 'boolean': return 'checkbox';
    case 'select': return 'select';
    case 'date': return 'date';
    default: return 'text';
  }
}

export interface FieldStatus {
  validation: FieldValidation;
  isRequired: boolean;
  /** Clase de tono de la fila (pim-auditoria--valid/review/missing/required-empty). */
  tone: string;
}

/** Estado y tono de una fila del esquema. */
export function fieldStatus(audit: AuditState, field: string, value: unknown): FieldStatus {
  const schema = audit.uonifySchema;
  const validation = audit.fieldValidations[field] || 'review';
  const isRequired = Boolean(schema?.required.includes(field));
  const isEmpty = !value || String(value).trim() === '';
  const tone = isRequired && isEmpty ? 'pim-auditoria--required-empty' : `pim-auditoria--${validation}`;
  return { validation, isRequired, tone };
}

/** Falta algún requerido del esquema: «Aplicar datos a Atributos» se deshabilita. */
export function schemaBlocked(audit: AuditState): boolean {
  const schema = audit.uonifySchema;
  return Boolean(schema) && audit.missingFields.some(field => schema!.required.includes(field));
}

/**
 * Qué vista lleva el único botón sólido (solo presentación), leído de las mismas
 * condiciones que deciden qué vistas se ven: el esquema, la sugerencia pendiente, el
 * selector de categoría (un select, sin botón), los atributos de Amazon y, si no, la auditoría.
 */
export function primaryOwner(audit: AuditState): PrimaryOwner {
  if (audit.showSchemaComparison && audit.uonifySchema) return 'schema';
  if (audit.suggestedCategory && audit.isCategoryConfirmed === null) return 'suggestion';
  if (audit.isCategoryConfirmed === false) return 'selector';
  if (audit.auditResult) return 'attributes';
  return 'audit';
}

/** Se ven las instrucciones (sin resultado de auditoría y sin campos mapeados). */
export function showIntro(audit: AuditState): boolean {
  return !audit.auditResult && Object.keys(audit.mappedFields || {}).length === 0;
}
