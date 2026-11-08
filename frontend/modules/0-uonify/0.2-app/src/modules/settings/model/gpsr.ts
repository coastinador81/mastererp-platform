import { isEmail, isHttpUrl } from './format';
import type { BrandGpsr, BrandGpsrInput, GpsrParty } from './types';

/**
 * GPSR por marca (Reglamento (UE) 2023/988): fabricante y persona responsable
 * en la UE con nombre, dirección postal y un contacto electrónico (correo o web).
 */
export const EMPTY_PARTY: Readonly<GpsrParty> = Object.freeze({ name: '', address: '', contact: '' });

export function emptyBrand(brand = ''): BrandGpsrInput {
  return { brand, manufacturer: { ...EMPTY_PARTY }, euResponsible: { ...EMPTY_PARTY }, autoApply: true };
}

export function brandInput(brand: BrandGpsr): BrandGpsrInput {
  return { brand: brand.brand, manufacturer: { ...brand.manufacturer }, euResponsible: { ...brand.euResponsible }, autoApply: brand.autoApply };
}

export type BrandErrors = Partial<Record<'brand' | `${'manufacturer' | 'euResponsible'}.${keyof GpsrParty}`, string>>;

function partyErrors(party: GpsrParty, key: 'manufacturer' | 'euResponsible', errors: BrandErrors): void {
  if (!party.name.trim()) errors[`${key}.name`] = 'Escribe el nombre o la razón social.';
  if (party.address.trim().length < 10) errors[`${key}.address`] = 'Escribe la dirección postal completa.';
  const contact = party.contact.trim();
  if (!contact) errors[`${key}.contact`] = 'Escribe un correo electrónico o una web.';
  else if (!isEmail(contact) && !isHttpUrl(contact)) errors[`${key}.contact`] = 'Usa un correo (nombre@empresa.com) o una web que empiece por https://.';
}

/** Errores del formulario (vacío = se puede guardar). */
export function validateBrand(input: BrandGpsrInput, existing: readonly BrandGpsr[] = [], editingId?: string): BrandErrors {
  const errors: BrandErrors = {};
  const brand = input.brand.trim();
  if (!brand) errors.brand = 'Escribe el nombre de la marca.';
  else if (existing.some(item => item.id !== editingId && sameBrand(item.brand, brand))) errors.brand = 'Esta marca ya tiene sus datos GPSR.';
  partyErrors(input.manufacturer, 'manufacturer', errors);
  partyErrors(input.euResponsible, 'euResponsible', errors);
  return errors;
}

export function sameBrand(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'es', { sensitivity: 'base' }) === 0;
}

/** Productos del catálogo de cada marca (clave normalizada → SKU). */
export function productsByBrand(products: ReadonlyArray<{ sku?: unknown; brand?: unknown }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  products.forEach(product => {
    const brand = typeof product.brand === 'string' ? product.brand.trim() : '';
    const sku = typeof product.sku === 'string' ? product.sku : '';
    if (!brand || !sku) return;
    const key = brand.toLocaleLowerCase('es');
    map.set(key, [...(map.get(key) ?? []), sku]);
  });
  return map;
}

export function skusForBrand(map: Map<string, string[]>, brand: string): string[] {
  return map.get(brand.trim().toLocaleLowerCase('es')) ?? [];
}

/** Marcas del catálogo que aún no tienen GPSR (con su nombre tal cual). */
export function brandsWithoutGpsr(products: ReadonlyArray<{ brand?: unknown }>, brands: readonly BrandGpsr[]): string[] {
  const names = new Map<string, string>();
  products.forEach(product => {
    const brand = typeof product.brand === 'string' ? product.brand.trim() : '';
    if (brand && !names.has(brand.toLocaleLowerCase('es'))) names.set(brand.toLocaleLowerCase('es'), brand);
  });
  return [...names.values()].filter(name => !brands.some(item => sameBrand(item.brand, name))).sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Valores para la pestaña GPSR de un producto de la marca (campos de pim-gpsr):
 * contacto del fabricante y dirección de la persona responsable en la UE.
 */
export function gpsrFieldsForProduct(brand: BrandGpsr): { manufacturer_contact: string; eu_responsible_address: string } {
  const responsible = brand.euResponsible;
  return {
    manufacturer_contact: brand.manufacturer.contact.trim(),
    eu_responsible_address: [responsible.name, responsible.address, responsible.contact].map(part => part.trim()).filter(Boolean).join(', '),
  };
}
