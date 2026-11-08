/**
 * Configuración de la API de Uonify.
 *
 * Todas las llamadas del frontend van a API_BASE + ruta (p. ej. «/api/video/projects»).
 * El modo habitual usa el backend local; MSW solo se activa explícitamente con
 * VITE_USE_MOCKS=true o dentro de las pruebas automatizadas.
 * Las rutas son las del prototipo HTML y forman el contrato del documento de backend.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === 'true' ||
  (import.meta.env.MODE === 'test' && import.meta.env.VITE_USE_MOCKS !== 'false');

/**
 * Versión de revisión para OpenAI: enseña la etiqueta «Simulado» en lo que aún no es real.
 * Los clientes nunca la ven (VITE_REVIEW_MODE=true solo en el entorno de revisión).
 */
export const REVIEW_MODE: boolean = import.meta.env.VITE_REVIEW_MODE === 'true';

/** Marketplace por defecto (Amazon.es) mientras no haya conexión real con Amazon. */
export const MARKETPLACE = { id: 'A1RKKUPIHCS9HS', countryCode: 'ES', currency: 'EUR', language: 'es_ES' } as const;

/** Construye la URL completa de una ruta de la API. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
