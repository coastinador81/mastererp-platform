/** Mantener esta copia y versión alineadas con product_materials_consent.py. */
export const MATERIAL_START_CONSENT_VERSION = 'materials-start-2026-10-17-v1';
export const MATERIAL_START_CONSENT_COPY = {
  label: 'Carpeta con los materiales del producto',
  description: 'Uony analizará los documentos y las imágenes de esta carpeta y sus subcarpetas. Tus originales se conservan.',
  budget: 'Presupuesto inicial: 200 llamadas y 1.000.000 de tokens. Al alcanzar el límite, el análisis se pausa automáticamente. El consumo se realiza en tu proyecto de Google conectado.',
  action: 'Analizar carpeta con Uony',
} as const;
export const MATERIAL_START_CONSENT_TEXT = Object.values(MATERIAL_START_CONSENT_COPY).join('\n');
export const MATERIAL_START_CONSENT_SHA256 = 'b49fba1b6f69419094ae185efd3802506d3b48f901a6a07ab5f4f08ff3e4e8ee';
