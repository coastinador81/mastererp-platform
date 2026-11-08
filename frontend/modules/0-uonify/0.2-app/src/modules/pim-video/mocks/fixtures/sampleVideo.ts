/**
 * Vídeo de muestra que devuelve la simulación como resultado de una generación:
 * el montaje real del producto de ejemplo (public/assets/video-uonify-v63), con sus
 * datos técnicos reales (1920 × 1080, 26,8 s, H.264 · AAC).
 */
export const SAMPLE_VIDEO = {
  url: '/assets/video-uonify-v63/uonify-juego-propuesta-v63.mp4',
  poster: '/assets/video-uonify-v63/portada.jpg',
  size: 28411446,
  type: 'video/mp4',
  width: 1920,
  height: 1080,
  duration: 26.8,
  codecs: 'H.264 · AAC',
} as const;

/**
 * Precio simulado por plano de 8 s con Veo 3.1 Standard a 1080p (coste × 1,40, que
 * decide el servidor): con audio 4,48 €, sin audio 2,24 €.
 */
export const SHOT_PRICE = { audio: 4.48, silent: 2.24 } as const;

/** Saldo inicial de la cuenta simulada. */
export const INITIAL_BALANCE = 60;
export const CURRENCY = 'EUR';
