import { MARKETPLACE, type PimProduct } from '@/shared/pim';

/**
 * Datos GPSR (Reglamento General de Seguridad de los Productos) de la pestaña
 * GPSR (prototipo: pim/gpsr.js; original: hooks/useAmazonAttributes.ts y
 * GPSRComplianceForm.tsx).
 */
export interface GpsrData {
  manufacturer_contact: string;
  eu_responsible_address: string;
  compliance_document_url: string;
  content_type: string;
  content_language: string;
  safety_attestation: boolean;
}

export type GpsrField = keyof GpsrData;

export const GPSR_DEFAULTS: Readonly<GpsrData> = Object.freeze({
  manufacturer_contact: '',
  eu_responsible_address: '',
  compliance_document_url: '',
  content_type: 'user_manual',
  content_language: 'es_ES',
  safety_attestation: false,
});

/** Tipos de contenido (value → texto), en el orden del original. */
export const CONTENT_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['user_manual', 'Manual de usuario'],
  ['user_guide', 'Guía de usuario'],
  ['safety_data_sheet', 'Hoja de datos de seguridad'],
  ['compliance_certificate', 'Certificado de cumplimiento'],
  ['test_report', 'Informe de pruebas'],
  ['warranty_information', 'Información de garantía'],
];

/** Datos técnicos (URL, código de idioma) en monoespaciada. */
export const MONO_FIELDS: ReadonlySet<GpsrField> = new Set<GpsrField>(['compliance_document_url', 'content_language']);

// Vendedor, marketplace y país fijos en el guardado (ProductsPIMInterface.tsx).
export const SELLER_ID = '1Y6J8';

type Raw = Record<string, Array<Record<string, unknown>> | undefined>;
const text = (value: unknown, fallback = '') => (typeof value === 'string' && value ? value : value ? String(value) : fallback);

/** extractGPSRData: lo importado de Amazon (_raw_attributes) o los valores vacíos. */
export function extractGPSRData(product: PimProduct | null | undefined): GpsrData {
  const attrs = product?._raw_attributes as Raw | undefined;
  if (!attrs || typeof attrs !== 'object') return { ...GPSR_DEFAULTS };
  const media = attrs.compliance_media?.[0];
  return {
    manufacturer_contact: text(attrs.gpsr_manufacturer_reference?.[0]?.gpsr_manufacturer_email_address),
    eu_responsible_address: text(attrs.dsa_responsible_party_address?.[0]?.value),
    compliance_document_url: text(media?.source_location),
    content_type: text(media?.content_type, 'user_manual'),
    content_language: text(media?.content_language, 'es_ES'),
    safety_attestation: Boolean(attrs.gpsr_safety_attestation?.[0]?.value) || false,
  };
}

/** gpsrData: lo editado (porción `gpsr`) sobre lo importado. */
export function mergeGpsr(stored: unknown, product: PimProduct | null): GpsrData {
  const base = extractGPSRData(product);
  return stored && typeof stored === 'object' ? { ...base, ...(stored as Partial<GpsrData>) } : base;
}

/** Cuerpo de «Guardar GPSR en Amazon» (manejador del botón en ProductsPIMInterface.tsx). */
export function buildGpsrPayload(target: Record<string, unknown>, data: GpsrData) {
  return {
    sku: target.sku,
    seller_id: SELLER_ID,
    marketplace_id: MARKETPLACE.id,
    country_code: MARKETPLACE.countryCode,
    product_type: target.productType || target.product_type,
    manufacturer_contact: data.manufacturer_contact,
    eu_responsible_address: data.eu_responsible_address,
    compliance_document_url: data.compliance_document_url,
    content_type: data.content_type || 'application/pdf',
    content_language: data.content_language || 'es_ES',
    safety_attestation: data.safety_attestation || false,
  };
}
export type GpsrPayload = ReturnType<typeof buildGpsrPayload>;
