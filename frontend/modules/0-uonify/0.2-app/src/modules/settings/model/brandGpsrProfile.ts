import { isEmail } from './format';
import { EU_COUNTRIES, isEuCountry } from '@/modules/pim-gpsr';

/**
 * Modelo del GPSR por marca (Reglamento UE 2023/988) como DEFAULTS REUTILIZABLES:
 * el fabricante y la persona responsable se guardan una vez y los productos de la
 * marca los HEREDAN (resolve_product_gpsr). Dirección ESTRUCTURADA con país (el
 * backend de Producto ya la usa así), correo OBLIGATORIO (no web), responsable en
 * la UE CONDICIONAL (solo si el fabricante está fuera de la UE) con su tipo. El
 * cumplimiento en Amazon (Brand Registry + vía B) YA NO vive aquí: se confirma al
 * publicar en Amazon. Presentación para el OK del dueño; el backend real de
 * /api/brands lo construye Producto. camelCase = forma de la API.
 */
export interface PostalAddress { street: string; postalCode: string; city: string; country: string }
export interface Manufacturer { name: string; postalAddress: PostalAddress; email: string; pointOfContact: string }
// Códigos EN del contrato camelCase que acepta el guardado (gpsr_capture.py: _RESPONSIBLE); el backend
// los mapea al español canónico (amazon_gpsr_adapter). Las tablas §2.1/§2.2 muestran el CANÓNICO, no lo
// que envía el frontend. La etiqueta visible va en español (RESPONSIBLE_TYPES).
export type ResponsibleType = 'importer' | 'authorized_representative' | 'logistics_provider';
export interface EuResponsible { type: ResponsibleType; name: string; postalAddress: PostalAddress; email: string }

export interface BrandGpsrProfile {
  brand: string;
  manufacturer: Manufacturer;
  /** Solo cuando el fabricante está fuera de la UE (se deriva del país). */
  euResponsible: EuResponsible | null;
  /** Aplicar estos datos (fabricante/responsable) a los productos de la marca. */
  autoApply: boolean;
}

/** Metadatos que añade el backend (/api/brands); el cuerpo del PUT los ignora salvo `revision`. */
export interface BrandProfileMeta { id: string; revision: number; createdAt: number; updatedAt: number }
/** Perfil tal cual lo devuelve /api/brands (perfil + metadatos). */
export type StoredBrandProfile = BrandGpsrProfile & BrandProfileMeta;

/** Etiquetas ES del tipo de responsable (co-acordadas con Producto). */
export const RESPONSIBLE_TYPES: ReadonlyArray<readonly [ResponsibleType, string]> = [
  ['importer', 'Importador'],
  ['authorized_representative', 'Representante autorizado'],
  ['logistics_provider', 'Prestador de servicios logísticos'],
];

/** Países del fabricante: UE-27 + algunos de fuera (para el selector). */
const NON_EU = [['GB', 'Reino Unido'], ['NO', 'Noruega'], ['CH', 'Suiza'], ['US', 'Estados Unidos'], ['CN', 'China'], ['TR', 'Turquía']] as const;
export const MANUFACTURER_COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ...EU_COUNTRIES.map(country => [country.iso2, country.name] as const),
  ...NON_EU,
].slice().sort((a, b) => a[1].localeCompare(b[1], 'es'));
/** Países del responsable: solo UE-27. */
export const EU_COUNTRY_OPTIONS: ReadonlyArray<readonly [string, string]> = EU_COUNTRIES
  .map(country => [country.iso2, country.name] as const).slice().sort((a, b) => a[1].localeCompare(b[1], 'es'));

export const EMPTY_ADDRESS: Readonly<PostalAddress> = Object.freeze({ street: '', postalCode: '', city: '', country: '' });
export function emptyBrandProfile(brand = ''): BrandGpsrProfile {
  return {
    brand,
    manufacturer: { name: '', postalAddress: { ...EMPTY_ADDRESS }, email: '', pointOfContact: '' },
    euResponsible: null,
    autoApply: true,
  };
}

/** ¿El fabricante está en la UE? Derivado del país (no lo marca el cliente). */
export function manufacturerInEu(profile: BrandGpsrProfile): boolean {
  return isEuCountry(profile.manufacturer.postalAddress.country);
}
/** ¿Hace falta la persona responsable en la UE? Solo si el fabricante está fuera. */
export function responsibleRequired(profile: BrandGpsrProfile): boolean {
  const country = profile.manufacturer.postalAddress.country;
  return !!country && !isEuCountry(country);
}

export type BrandProfileErrors = Record<string, string>;

function addressErrors(address: PostalAddress, key: string, errors: BrandProfileErrors, euOnly = false): void {
  if (!address.street.trim()) errors[`${key}.street`] = 'Escribe la calle y el número.';
  if (!address.postalCode.trim()) errors[`${key}.postalCode`] = 'Escribe el código postal.';
  if (!address.city.trim()) errors[`${key}.city`] = 'Escribe la ciudad.';
  if (!address.country) errors[`${key}.country`] = 'Elige el país.';
  else if (euOnly && !isEuCountry(address.country)) errors[`${key}.country`] = 'La persona responsable debe estar en la UE.';
}

/** Validación de la UI (espeja product_gpsr del backend) para avisar antes de guardar. */
export function validateBrandProfile(profile: BrandGpsrProfile): BrandProfileErrors {
  const errors: BrandProfileErrors = {};
  if (!profile.brand.trim()) errors.brand = 'Escribe el nombre de la marca.';
  const m = profile.manufacturer;
  if (!m.name.trim()) errors['manufacturer.name'] = 'Escribe el nombre o la razón social.';
  addressErrors(m.postalAddress, 'manufacturer.postalAddress', errors);
  if (!m.email.trim()) errors['manufacturer.email'] = 'Escribe un correo electrónico.';
  else if (!isEmail(m.email.trim())) errors['manufacturer.email'] = 'Usa un correo válido (nombre@empresa.com).';

  if (responsibleRequired(profile)) {
    const r = profile.euResponsible;
    if (!r) errors['euResponsible'] = 'El fabricante está fuera de la UE: añade la persona responsable en la UE.';
    else {
      if (!r.name.trim()) errors['euResponsible.name'] = 'Escribe el nombre o la razón social.';
      addressErrors(r.postalAddress, 'euResponsible.postalAddress', errors, true);
      if (!r.email.trim()) errors['euResponsible.email'] = 'Escribe un correo electrónico.';
      else if (!isEmail(r.email.trim())) errors['euResponsible.email'] = 'Usa un correo válido (nombre@empresa.com).';
    }
  }
  return errors;
}

export function isBrandProfileComplete(profile: BrandGpsrProfile): boolean {
  return Object.keys(validateBrandProfile(profile)).length === 0;
}
