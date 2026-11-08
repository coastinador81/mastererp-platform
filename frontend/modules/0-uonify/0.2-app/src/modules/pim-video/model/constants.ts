import type { Destination, ProjectStatus, ShotStatus, VideoFormat } from './types';

/**
 * Constantes de la pestaña «Vídeo» (prototipo: pim/video.js, «constantes»).
 * Requisitos de Amazon a 26-09-2026 (Seller Central y Amazon Ads).
 */
export const LISTING_MAX_BYTES = 5 * 1024 ** 3; // ficha: hasta 5 GB
export const ADS_MAX_BYTES = 500 * 1024 ** 2; // anuncios: hasta 500 MB
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov';
export const POSTER_ACCEPT = 'image/jpeg,image/png';
export const POSTER_WIDTH = 960;
export const POLL_MS = 5000;
export const TEXT_MAX = 42; // texto en pantalla: legible a 50 pt
export const ACTION_MAX = 400;

/**
 * Rutas del servidor de vídeo (bajo API_BASE, con @/shared/api/client).
 * Son el contrato del backend (mismas que el prototipo).
 */
export const PATHS = {
  balance: '/billing/balance',
  plans: '/video/plans',
  projects: '/video/projects',
  downloads: '/video/downloads',
  adsConnection: '/amazon/ads/connection',
  adsAssets: '/amazon/ads/assets',
  uploads: '/uploads',
} as const;

/**
 * Decisión del dueño: hasta que exista la conexión con Amazon Ads, la acción del
 * anuncio es «Descargar para Amazon Ads» (en lugar de «Enviar a Amazon Ads»). Lo
 * decide el servidor (GET /amazon/ads/connection): con la cuenta conectada, el vídeo
 * se envía con POST /amazon/ads/assets; sin ella, se descarga listo para subirlo.
 */

/** Consola de Amazon Ads por país del marketplace (biblioteca de recursos creativos). */
export const ADS_CONSOLE: Record<string, string> = {
  ES: 'advertising.amazon.es', DE: 'advertising.amazon.de', FR: 'advertising.amazon.fr', IT: 'advertising.amazon.it',
  UK: 'advertising.amazon.co.uk', GB: 'advertising.amazon.co.uk', US: 'advertising.amazon.com',
};

// Textos aprobados por el abogado del dueño (26-09-2026): se publican tal cual.
export const TERMS_VERSION = '2026-09-26';
export const TERMS_KEY = 'uonify-ai-terms';
export const TERMS_TITLE = 'Modelos de IA de terceros.';
export const TERMS_TEXT = 'Uonify genera vídeos, imágenes y textos con modelos de inteligencia artificial de terceros, como Google u OpenAI. Su disponibilidad, funcionamiento y precio dependen de esos proveedores y pueden cambiar sin previo aviso. Si el modelo previsto no está disponible, Uonify podrá completar la tarea con otro modelo o plataforma disponible para entregarte el resultado solicitado. En ese caso, el saldo consumido corresponderá al modelo utilizado, que puede ser distinto del previsto.';
export const AUDIO_NOTICE = 'Con audio, cada vídeo consume más saldo que sin audio. Los modelos de IA son servicios de terceros: si el previsto no está disponible, usaremos otro para completar tu vídeo y se descontará el saldo del modelo utilizado.';

export interface DestinationSpec {
  label: string;
  detail: string;
  shots: number;
  shotSeconds: number;
  closingSeconds: number;
  formats: VideoFormat[];
  icon: string;
}

// Destinos. Veo genera planos de 8 s a 1080p; el montaje recorta cada plano y añade
// el cierre de marca hasta la duración final (30 s la ficha, 15 s el anuncio).
export const DESTINATIONS: Record<Destination, DestinationSpec> = {
  listing: { label: 'Ficha de Amazon', detail: '30 s · 16:9 o 9:16 · hasta 1080p', shots: 4, shotSeconds: 7, closingSeconds: 2, formats: ['16:9', '9:16'], icon: 'package' },
  ads: { label: 'Anuncio', detail: '15 s · 16:9 · 1920 × 1080 · Sponsored Brands y display', shots: 2, shotSeconds: 6.5, closingSeconds: 2, formats: ['16:9'], icon: 'megaphone' },
};
export const DESTINATION_IDS = Object.keys(DESTINATIONS) as Destination[];
export const isDestination = (value: unknown): value is Destination => value === 'listing' || value === 'ads';

export const CAMERAS: [string, string][] = [['push_in', 'Acercamiento lento'], ['orbit', 'Giro alrededor'], ['pan', 'Desplazamiento lateral'], ['pedestal', 'Elevación'], ['static', 'Plano fijo']];
export const ACTION_DRAFTS: Record<Destination, string[]> = {
  listing: [
    'El producto en primer plano sobre una superficie limpia; la cámara se acerca despacio y muestra su forma y sus materiales.',
    'El producto en uso en un entorno cotidiano, con luz natural suave.',
    'Detalle cercano de los materiales y los acabados del producto.',
    'Vista general del producto completo, con todo lo que incluye.',
  ],
  ads: [
    'El producto aparece desde el primer segundo, bien iluminado, mientras la cámara se acerca.',
    'El producto en uso, con un movimiento de cámara suave y luz cálida.',
  ],
};
export const CAMERA_DRAFTS = ['push_in', 'orbit', 'pan', 'pedestal'];
export const PROVIDERS: Record<string, string> = { 'gemini-api': 'Gemini API', 'vertex-ai': 'Vertex AI' };
export const MODELS: Record<string, string> = { 'veo-3.1': 'Veo 3.1', 'veo-3.1-generate-001': 'Veo 3.1', 'veo-3.1-generate-preview': 'Veo 3.1' };
export const LANGUAGES: [string, string][] = [['es', 'Español'], ['en', 'Inglés'], ['fr', 'Francés'], ['de', 'Alemán'], ['it', 'Italiano'], ['pt', 'Portugués']];
export const SELLER_CENTRAL: Record<string, string> = { ES: 'sellercentral.amazon.es', DE: 'sellercentral.amazon.de', FR: 'sellercentral.amazon.fr', IT: 'sellercentral.amazon.it', UK: 'sellercentral.amazon.co.uk', GB: 'sellercentral.amazon.co.uk', US: 'sellercentral.amazon.com' };

export const ACTIVE = new Set<ProjectStatus>(['queued', 'generating', 'editing']);
export const PROJECT_STATUSES = new Set<string>([...ACTIVE, 'waiting', 'done', 'failed']);
export const SHOT_STATUSES = new Set<string>(['queued', 'generating', 'done', 'blocked', 'failed']);
export const PROJECT_LABELS: Record<ProjectStatus, string> = { queued: 'En cola', generating: 'Generando los planos', editing: 'Montando el vídeo', waiting: 'Falta rehacer algún plano', done: 'Listo', failed: 'No se pudo generar' };
export const SHOT_LABELS: Record<ShotStatus, { label: string; tone: string }> = {
  queued: { label: 'En cola', tone: 'pim-badge-outline' },
  generating: { label: 'Generando', tone: 'pim-badge-ai' },
  done: { label: 'Listo', tone: 'pim-badge-green' },
  blocked: { label: 'Bloqueado por los filtros de Google · no se descuenta', tone: 'pim-badge-amber' },
  failed: { label: 'No se pudo generar', tone: 'pim-badge-red' },
};

/** Descarga local hasta que exista la conexión con Amazon Ads. */
export const AMAZON_ADS_CONNECTED = false;
