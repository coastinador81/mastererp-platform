import type { PimProduct } from '@/shared/pim';
import type { CustomField } from './types';

/**
 * Campos personalizados por defecto (prototipo: pim/atributos.js,
 * generateCustomFields y UonifyPIM.defaultCustomFields; original:
 * hooks/useAmazonAttributes.ts). Un producto de Amazon trae sus atributos en
 * `_raw_attributes`; se convierten en campos confirmados (E31).
 */

const EXCLUDED_ATTRIBUTES = [
  'bullet_point', 'generic_keyword', 'rtip_product_description', 'hazmat', 'specification_met', 'product_category',
  'color', 'model', 'cost_price', 'item_name', 'recommended_browse_nodes', 'model_number', 'part_number',
  'size', 'weight', 'item_weight', 'shipping_weight', 'website_shipping_weight', 'manufacturer', 'brand', 'style',
  'merchant_suggested_asin', 'external_product_id', 'item_depth_width_height', 'item_package_dimensions',
];

const ATTRIBUTE_NAMES: Record<string, string> = {
  brand: 'Marca', manufacturer: 'Fabricante', material: 'Material', battery_type: 'Tipo de Batería', warranty: 'Garantía',
  warranty_description: 'Descripción de Garantía', country_of_origin: 'País de Origen', batteries_required: 'Requiere Baterías',
  batteries_included: 'Baterías Incluidas', included_components: 'Componentes Incluidos', voltage: 'Voltaje', wattage: 'Potencia',
  power_plug_type: 'Tipo de Enchufe', accepted_voltage_frequency: 'Frecuencia de Voltaje Aceptada', installation_type: 'Tipo de Instalación',
  temperature_rating: 'Clasificación de Temperatura', number_of_items: 'Número de Artículos', number_of_shelves: 'Número de Estantes',
  package_level: 'Nivel de Paquete', eprel_registration_number: 'Número de Registro EPREL', item_type_name: 'Nombre del Tipo de Artículo',
  item_package_weight: 'Peso del Paquete del Artículo', rtip_items_per_inner_pack: 'Artículos por Paquete Interno',
  supplier_declared_dg_hz_regulation: 'Regulación DG Hz Declarada por Proveedor', gdpr_risk: 'Riesgo GDPR',
  product_site_launch_date: 'Fecha de Lanzamiento del Producto', eu_energy_efficiency_rating: 'Calificación de Eficiencia Energética UE',
  language: 'Idioma', is_trade_item_orderable_unit: 'Es Unidad Ordenable de Artículo Comercial',
  product_subcategory: 'Subcategoría de Producto', model_name: 'Nombre del Modelo',
};

type RawValue = { value?: unknown; unit?: unknown; [field: string]: unknown };
type RawAttributes = Record<string, unknown>;

const firstOf = (values: unknown): RawValue | undefined => {
  if (!Array.isArray(values)) return undefined;
  const first: unknown = values[0];
  return first !== null && typeof first === 'object' ? (first as RawValue) : undefined;
};

const titleCase = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

const confirmed = (id: string, name: string, type: string, value: CustomField['value']): CustomField => ({
  id, name, type, value, options: [], isConfirmed: true,
});

/** Campos generados desde los atributos de Amazon (solo productos de source 'amazon'). */
export function generateCustomFields(product: PimProduct | null | undefined, key: string): CustomField[] {
  if (!product || product.source !== 'amazon') return [];
  const fields: CustomField[] = [];
  const attrs = (product._raw_attributes && typeof product._raw_attributes === 'object' ? product._raw_attributes : {}) as RawAttributes;
  if (product.asin) fields.push(confirmed(`field-asin-${key}`, 'ASIN', 'text', String(product.asin)));
  const ean = firstOf(attrs.external_product_id)?.value;
  if (ean) fields.push(confirmed(`field-ean-${key}`, 'EAN', 'text', String(ean)));
  const dims = firstOf(attrs.item_depth_width_height);
  if (dims) {
    ([['height', 'Alto'], ['width', 'Ancho'], ['depth', 'Profundidad']] as const).forEach(([dim, name]) => {
      const measure = dims[dim] as RawValue | undefined;
      if (measure?.value) fields.push(confirmed(`field-${dim}-${key}`, name, 'text', `${String(measure.value)} ${String(measure.unit || 'cm')}`));
    });
  }
  const added = new Set<string>();
  Object.entries(attrs).forEach(([attrKey, values]) => {
    if (EXCLUDED_ATTRIBUTES.includes(attrKey.toLowerCase()) || added.has(attrKey)) return;
    if (!Array.isArray(values) || values.length === 0) return;
    const first: unknown = values[0];
    let value: CustomField['value'] = '';
    let type = 'text';
    if (first !== null && typeof first === 'object' && (first as RawValue).value !== undefined) {
      const raw = first as RawValue;
      if (typeof raw.value === 'boolean') {
        value = raw.value;
        type = 'checkbox';
      } else {
        value = String(raw.value);
        if (raw.unit) value += ` ${String(raw.unit)}`;
        else if (typeof raw.value === 'number') type = 'number';
      }
    } else if (typeof first === 'string' || typeof first === 'number') {
      value = String(first);
      type = typeof first === 'number' ? 'number' : 'text';
    }
    if (value === '' || value === null) return;
    added.add(attrKey);
    fields.push(confirmed(`field-${attrKey}-${key}`, ATTRIBUTE_NAMES[attrKey] || titleCase(attrKey), type, value));
  });
  return fields;
}

/**
 * Lista inicial de la porción `customFields` (una sola lista, como
 * attributesManager.customFields): los campos del producto o los generados
 * desde Amazon. Se registra en @/shared/pim para que catalog la siembre.
 */
export function defaultCustomFields(product: PimProduct | null, key: string): CustomField[] {
  return Array.isArray(product?.customFields) ? (product.customFields as CustomField[]) : generateCustomFields(product, key);
}
