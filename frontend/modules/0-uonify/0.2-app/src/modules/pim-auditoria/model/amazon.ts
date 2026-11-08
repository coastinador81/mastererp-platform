import type { AuditState, CustomField, FieldMap } from './types';
import { ATTRIBUTE_MAPPING, hasValue, own, translateAttribute } from './translations';

/**
 * «Atributos Amazon» (AmazonAttributesSection del original): lectura defensiva del
 * resultado de /ai-audit (A04) y aplicación de los atributos a los campos personalizados.
 */

export interface MissingRow {
  label: string;
  originalKey: string;
  value: unknown;
}

export interface ExistingRow {
  key: string;
  label: string;
  value: unknown;
  isRequired: boolean;
}

export interface AmazonModel {
  attrs: FieldMap;
  productType: { name: string; required_attributes: string[]; optional_attributes: string[] };
  missingRequired: string[];
  missingOptional: string[];
  recommendations: unknown[];
  detectedCategory: string;
  readiness: string;
  overall: string;
  mappedCount: number;
  totalAttributes: number;
  completionPercentage: number;
  missingRows: MissingRow[];
  existingRows: ExistingRow[];
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown): string[] => list(value).map(item => String(item));
const text = (value: unknown, fallback: string): string => (value === null || value === undefined ? fallback : String(value));

export function amazonModel(audit: AuditState): AmazonModel {
  const result = isObject(audit.auditResult) ? audit.auditResult : {};
  const ai = isObject(result.ai_audit) ? result.ai_audit : {};
  const attrs: FieldMap = isObject(audit.amazonAttributes) ? audit.amazonAttributes : {};
  const apt = isObject(result.amazon_product_type) ? result.amazon_product_type : {};
  const productType = {
    name: text(apt.name, ''),
    required_attributes: strings(apt.required_attributes),
    optional_attributes: strings(apt.optional_attributes),
  };
  const missingRequired = strings(ai.missing_required_attributes);
  const missingOptional = strings(ai.missing_optional_attributes);
  const recommendations = list(ai.recommendations);
  const scores = isObject(ai.audit_scores) ? ai.audit_scores : {};
  const keys = Object.keys(attrs);
  const mappedCount = Object.values(attrs).filter(hasValue).length;
  const totalAttributes = keys.length;
  const completionPercentage = totalAttributes > 0 ? Math.round((mappedCount / totalAttributes) * 100) : 0;
  // E12: la clave faltante se reconoce traducida o en inglés (sin filas duplicadas).
  const matches = (item: string) => (key: string) => translateAttribute(key) === item || key === item;
  const missingRows = missingRequired.map(item => {
    const originalKey = keys.find(matches(item)) || productType.required_attributes.find(matches(item)) || item;
    return { label: translateAttribute(item), originalKey, value: attrs[originalKey] };
  });
  const isMissing = (key: string) => missingRequired.includes(translateAttribute(key)) || missingRequired.includes(key);
  const existingRows = keys.filter(key => !isMissing(key)).map(key => ({
    key,
    label: translateAttribute(key),
    value: attrs[key],
    isRequired: productType.required_attributes.includes(key),
  }));
  return {
    attrs,
    productType,
    missingRequired,
    missingOptional,
    recommendations,
    detectedCategory: text(result.detected_category, ''),
    readiness: text(scores.amazon_readiness, '0'),
    overall: text(scores.overall_score, '0'),
    mappedCount,
    totalAttributes,
    completionPercentage,
    missingRows,
    existingRows,
  };
}

export const applyAttributesLabel = (model: AmazonModel): string => `Aplicar Atributos al Producto (${model.totalAttributes} campos)`;

/**
 * Clave con la que se añade un opcional pulsado (su clave de Amazon si la etiqueta
 * coincide), o null si ya existe: E15, un opcional no vacía un atributo con valor.
 */
export function optionalKeyToAdd(model: AmazonModel, attr: string): string | null {
  const originalKey = model.productType.optional_attributes.find(key => translateAttribute(key) === attr) || attr;
  return Object.prototype.hasOwnProperty.call(model.attrs, originalKey) ? null : originalKey;
}

/** Atributos con valor (los que aplica «Aplicar Atributos al Producto»). */
export function validAttributes(attributes: FieldMap): FieldMap {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => hasValue(value)));
}

/**
 * onApplyToAttributes del original sobre la porción customFields (E17): cada clave
 * actualiza el campo con su nombre mapeado (o su clave o id) o crea uno nuevo; dos
 * claves del mismo clic con el mismo nombre se funden en un campo.
 */
export function applyAttributesToFields(current: CustomField[], attrs: FieldMap, now = Date.now()): CustomField[] {
  const fields = current.map(field => ({ ...field }));
  Object.entries(attrs).forEach(([key, value]) => {
    const mappedName = own(ATTRIBUTE_MAPPING, key) || key;
    const existing = fields.find(field => field.name === mappedName || field.name === key || field.id === key);
    if (existing) existing.value = value;
    else {
      fields.push({
        id: `audit_${key}_${now}`,
        name: mappedName,
        value,
        type: typeof value === 'number' ? 'number' : 'text',
        options: [],
        isConfirmed: true,
        source: 'audit_ia',
      });
    }
  });
  return fields;
}
