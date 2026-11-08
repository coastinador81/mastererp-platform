/**
 * Modelo del GPSR del producto (rediseño, Reglamento UE 2023/988). La forma y la
 * validación las fija el hilo Producto (product_gpsr.py); aquí solo vive la
 * presentación: datos de la UE (para deducir «¿fabricante en la UE?» y las
 * lenguas de las advertencias), el modelo del producto, la traducción de los
 * códigos de la PUERTA UE que calcula el backend, y los textos legales EXACTOS.
 * No reescribir los textos legales (§5/§8 de la espec, entregados por Legal).
 */

/** UE-27: ISO2 → nombre y lenguas oficiales (langTag). Multilingües = varias. */
export const EU_COUNTRIES: { iso2: string; name: string; languages: string[] }[] = [
  { iso2: 'AT', name: 'Austria', languages: ['de_AT'] },
  { iso2: 'BE', name: 'Bélgica', languages: ['nl_BE', 'fr_BE', 'de_BE'] },
  { iso2: 'BG', name: 'Bulgaria', languages: ['bg_BG'] },
  { iso2: 'HR', name: 'Croacia', languages: ['hr_HR'] },
  { iso2: 'CY', name: 'Chipre', languages: ['el_CY', 'tr_CY'] },
  { iso2: 'CZ', name: 'Chequia', languages: ['cs_CZ'] },
  { iso2: 'DK', name: 'Dinamarca', languages: ['da_DK'] },
  { iso2: 'EE', name: 'Estonia', languages: ['et_EE'] },
  { iso2: 'FI', name: 'Finlandia', languages: ['fi_FI', 'sv_FI'] },
  { iso2: 'FR', name: 'Francia', languages: ['fr_FR'] },
  { iso2: 'DE', name: 'Alemania', languages: ['de_DE'] },
  { iso2: 'GR', name: 'Grecia', languages: ['el_GR'] },
  { iso2: 'HU', name: 'Hungría', languages: ['hu_HU'] },
  { iso2: 'IE', name: 'Irlanda', languages: ['en_IE', 'ga_IE'] },
  { iso2: 'IT', name: 'Italia', languages: ['it_IT'] },
  { iso2: 'LV', name: 'Letonia', languages: ['lv_LV'] },
  { iso2: 'LT', name: 'Lituania', languages: ['lt_LT'] },
  { iso2: 'LU', name: 'Luxemburgo', languages: ['fr_LU', 'de_LU', 'lb_LU'] },
  { iso2: 'MT', name: 'Malta', languages: ['mt_MT', 'en_MT'] },
  { iso2: 'NL', name: 'Países Bajos', languages: ['nl_NL'] },
  { iso2: 'PL', name: 'Polonia', languages: ['pl_PL'] },
  { iso2: 'PT', name: 'Portugal', languages: ['pt_PT'] },
  { iso2: 'RO', name: 'Rumanía', languages: ['ro_RO'] },
  { iso2: 'SK', name: 'Eslovaquia', languages: ['sk_SK'] },
  { iso2: 'SI', name: 'Eslovenia', languages: ['sl_SI'] },
  { iso2: 'ES', name: 'España', languages: ['es_ES'] },
  { iso2: 'SE', name: 'Suecia', languages: ['sv_SE'] },
];
const EU_SET = new Set(EU_COUNTRIES.map(country => country.iso2));
/** Países con varias lenguas oficiales: hay que ELEGIR la lengua de la advertencia. */
export const MULTILINGUAL = new Set(['BE', 'LU', 'IE', 'FI', 'MT', 'CY']);

export function isEuCountry(iso2: string | undefined): boolean {
  return !!iso2 && EU_SET.has(iso2.toUpperCase());
}
export function countryName(iso2: string): string {
  return EU_COUNTRIES.find(country => country.iso2 === iso2.toUpperCase())?.name ?? iso2;
}

/** Textos legales EXACTOS (no reescribir). Declaración del vendedor (§5). */
export const SELLER_DECLARATION = {
  es: 'Confirmo que este producto es seguro y cumple la normativa de la UE que le es aplicable, incluido el Reglamento (UE) 2023/988. Los datos del fabricante, de la persona responsable y de seguridad son correctos y figuran también en el producto, en su envase o en un documento que lo acompaña.',
  en: 'I confirm that this product is safe and complies with the EU legislation that applies to it, including Regulation (EU) 2023/988. The manufacturer, responsible person and safety information is correct and also appears on the product, its packaging or an accompanying document.',
} as const;
/** Alta en «Manage Your Compliance» (vía B de Amazon, §8, regla 9 de Legal). */
export const AMAZON_COMPLIANCE_DECLARATION = {
  es: 'He dado de alta en Seller Central de Amazon al fabricante de esta marca y a su persona responsable en la UE, con su nombre, su dirección postal y su correo. Los correos son los mismos que he puesto en Uonify.',
  en: 'I have registered this brand’s manufacturer and its EU responsible person in Amazon Seller Central, with their name, postal address and email. The email addresses are the same as the ones I entered in Uonify.',
} as const;

export interface SafetyWarning { language: string; text: string; aiProposed?: boolean }

/** Tipo de identificador (esquema de Producto: `identifiers` guardado por tipo). */
export type IdentifierType = 'ean' | 'gtin' | 'manufacturer_ref' | 'sku';
/** Etiquetas ES del tipo de identificador. Para Amazon solo valen EAN/GTIN. */
export const IDENTIFIER_TYPES: ReadonlyArray<readonly [IdentifierType, string]> = [
  ['ean', 'EAN'],
  ['gtin', 'GTIN'],
  ['manufacturer_ref', 'Referencia del fabricante'],
  ['sku', 'SKU'],
];

/** Seguridad de juguete (Directiva 2009/48/CE). Obligatoria y bloqueante para un juguete;
 * sale de los atributos reales eu_toys_safety_directive_* del PTD. Forma a confirmar con
 * Producto (producto lidera la certificación de campos). */
export type ToyWarning =
  | 'choking_hazard_small_parts' | 'choking_hazard_general' | 'risk_of_suffocation'
  | 'small_magnets_swallowing_risk' | 'sharp_edges_points' | 'adult_assembly_required' | 'no_warning_applicable';
export type ToyAgeWarning =
  | 'not_suitable_under_3_years' | 'not_suitable_under_3_years_supervision'
  | 'not_suitable_under_14_years' | 'no_warning_applicable';

export interface ToySafety {
  /** eu_toys_safety_directive_warning (VARIAS): un juguete puede llevar más de una. */
  warnings: ToyWarning[];
  /** eu_toys_safety_directive_age_warning. */
  ageWarning: ToyAgeWarning | '';
  /** eu_toys_safety_directive_language. */
  language: string;
  /** age_range_description (texto localizado). */
  ageRangeDescription: string;
  /** compliance_recommended_age. */
  recommendedAge: 'over_3_years_of_age' | 'under_3_years_of_age' | '';
  /** manufacturer_minimum_age / _maximum_age (número en el backend; texto en el formulario). */
  minAge: string;
  maxAge: string;
}

/** Etiquetas ES (subconjunto relevante a bloques + «no necesita»; enum real de 45/39 valores).
 * MAQUETA: en producción las opciones salen del PTD vivo (no se hardcodean), para que no se
 * desactualicen cuando Amazon cambie la plantilla. */
export const TOY_WARNINGS: ReadonlyArray<readonly [ToyWarning, string]> = [
  ['choking_hazard_small_parts', 'Peligro de asfixia: piezas pequeñas'],
  ['choking_hazard_general', 'Peligro de asfixia (general)'],
  ['risk_of_suffocation', 'Riesgo de asfixia'],
  ['small_magnets_swallowing_risk', 'Imanes pequeños: riesgo de ingestión'],
  ['sharp_edges_points', 'Bordes o puntas afiladas'],
  ['adult_assembly_required', 'Montaje por un adulto'],
  ['no_warning_applicable', 'No necesita advertencia'],
];
export const TOY_AGE_WARNINGS: ReadonlyArray<readonly [ToyAgeWarning, string]> = [
  ['not_suitable_under_3_years', 'No apto para menores de 3 años'],
  ['not_suitable_under_3_years_supervision', 'Menores de 3 años solo con supervisión'],
  ['not_suitable_under_14_years', 'No apto para menores de 14 años'],
  ['no_warning_applicable', 'No necesita advertencia de edad'],
];
export const RECOMMENDED_AGES: ReadonlyArray<readonly [string, string]> = [
  ['over_3_years_of_age', 'A partir de 3 años'],
  ['under_3_years_of_age', 'Menos de 3 años'],
];

export function emptyToySafety(): ToySafety {
  return { warnings: [], ageWarning: '', language: '', ageRangeDescription: '', recommendedAge: '', minAge: '', maxAge: '' };
}
/** Completa (y por tanto no bloquea): al menos una advertencia + advertencia de edad + lengua
 * + edad mínima y máxima (Amazon exige manufacturer_min/max_age para SKU autónomo). La edad
 * recomendada es lo único opcional (confirmado por Producto, spec §2.4). */
export function toySafetyComplete(t: ToySafety): boolean {
  return t.warnings.length > 0 && t.ageWarning !== '' && t.language.trim() !== ''
    && t.minAge.trim() !== '' && t.maxAge.trim() !== '';
}

/** GPSR del producto (se guarda en data.gpsr por /api/products; forma de Producto). */
export interface ProductGpsrData {
  brand: string;
  model: string;
  /** Tipo del identificador externo (el esquema guarda por tipo; Amazon exige EAN/GTIN). */
  identifierType: IdentifierType;
  identifier: string;
  /** Seguridad de juguete (Directiva 2009/48/CE); obligatoria para un juguete. */
  toySafety: ToySafety;
  hasImage: boolean;
  saleCountries: string[];
  warnings: SafetyWarning[];
  noWarningsNeeded: boolean;
  ownLegislationNotice: string;
  sellerDeclaration: boolean;
  /** Estado de Brand Registry de la marca (heredado); si 'no', la vía B va por SKU aquí. */
  brandRegistry: 'yes' | 'no' | 'unknown';
  /** Vía B por tienda a nivel de producto (solo cuando la marca NO está en Brand Registry). */
  amazonCompliance: import('./amazonViaB').AmazonCompliance;
}

/** Códigos de `missing` de la puerta UE (backend) → mensaje para el cliente. */
export function gateMessage(code: string): string {
  if (code.startsWith('brand_eu_responsible')) return 'Falta la persona responsable en la UE en el perfil de la marca.';
  if (code.startsWith('brand_')) return 'El perfil GPSR de la marca está incompleto.';
  if (code.startsWith('warnings_review_')) return `Elige la lengua de la advertencia para ${countryName(code.replace('warnings_review_', ''))} (país con varias lenguas).`;
  if (code.startsWith('warnings_unknown_country_')) return `Añade la advertencia de seguridad para ${countryName(code.replace('warnings_unknown_country_', ''))} (no reconozco sus lenguas; revísala).`;
  if (code.startsWith('warnings_')) return `Falta la advertencia de seguridad en la lengua de ${countryName(code.replace('warnings_', ''))}.`;
  const fixed: Record<string, string> = {
    model: 'Falta el modelo o tipo del producto.',
    identifier: 'Falta un identificador (GTIN/EAN, referencia del fabricante o SKU).',
    image: 'Falta al menos una imagen del producto.',
    countries_of_sale: 'Elige en qué países de la UE se vende.',
    seller_declaration: 'Falta tu declaración de seguridad.',
    amazon_compliance_panel: 'Confirma que diste de alta la marca en «Manage Your Compliance» de Seller Central.',
  };
  return fixed[code] ?? code;
}

const MAX = 2000;
/** Validación local (espeja product_gpsr.py) para avisar antes de guardar. */
export function validateProductGpsr(data: ProductGpsrData): { itemErrors: Record<string, string>; warningErrors: (string | null)[]; ok: boolean } {
  const itemErrors: Record<string, string> = {};
  if (!data.model.trim()) itemErrors.model = 'Escribe el modelo o tipo.';
  if (!data.identifier.trim()) itemErrors.identifier = 'Hace falta un identificador (el SKU cuenta).';
  if (!data.saleCountries.length) itemErrors.saleCountries = 'Elige al menos un país de venta.';
  if (!data.noWarningsNeeded && !data.warnings.some(warning => warning.text.trim())) itemErrors.warnings = 'Añade una advertencia por lengua o marca «no necesita advertencias».';
  if (!data.sellerDeclaration) itemErrors.sellerDeclaration = 'Marca la declaración de seguridad para publicar en la UE.';
  const warningErrors = data.warnings.map(warning => {
    if (!warning.language) return 'Elige la lengua.';
    if (!warning.text.trim()) return 'Escribe la advertencia.';
    if (warning.text.length > MAX) return 'Demasiado largo.';
    return null;
  });
  const ok = !Object.keys(itemErrors).length && warningErrors.every(error => !error);
  return { itemErrors, warningErrors, ok };
}
