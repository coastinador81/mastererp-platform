import { LANGUAGES, VIDEO_TYPES } from './constants';
import type { Charged, Destination } from './types';

/**
 * Formatos y comprobaciones puras de la pestaña «Vídeo» (prototipo: pim/video.js,
 * «utilidades»). Cifras en es-ES.
 */

export const asArray = <T = unknown>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
export const isRemote = (url: unknown): boolean => /^https?:\/\//i.test(String(url || ''));

/**
 * URL que el servidor puede leer: http(s) o una ruta de este origen («/assets/…», como
 * las fotos del producto de ejemplo). Las data: y blob: solo existen en el navegador.
 */
export const isServerURL = (url: unknown): boolean => isRemote(url) || /^\/(?!\/)/.test(String(url || ''));

/** La URL completa (las rutas de este origen se resuelven con él) para enviarla al servidor. */
export function absoluteURL(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

/** Lo que llega del servidor para reproducir o descargar: https o una ruta de este origen. */
export const safeMediaURL = (url: unknown): string =>
  typeof url === 'string' && (/^https:\/\//i.test(url) || /^\/(?!\/)/.test(url)) ? url : '';

/** Si la URL es de otro origen (hay que pedirla con CORS para leer fotogramas). */
export function crossOrigin(url: string): boolean {
  try {
    return isRemote(url) && new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

export const decimal = (value: number, digits = 1): string =>
  Number(value).toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatSize(bytes: unknown): string {
  const size = Number(bytes) || 0;
  if (size >= 1024 ** 3) return `${decimal(size / 1024 ** 3, 2)} GB`;
  if (size >= 1024 ** 2) return `${decimal(size / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** m:ss, como el reproductor. */
export function formatTime(seconds: unknown): string {
  const total = Math.max(0, Math.floor((Number(seconds) || 0) + 0.001));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Tiempos del guion: m:ss, con décima cuando la hay (0:06,5). */
export function clock(seconds: unknown): string {
  const value = Math.max(0, Math.round((Number(seconds) || 0) * 10) / 10);
  const whole = Math.floor(value);
  const tenth = Math.round((value - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${tenth ? `,${tenth}` : ''}`;
}

export const isVideoFile = (file: { type?: string; name?: string }): boolean =>
  VIDEO_TYPES.includes(file.type || '') || /\.(mp4|mov)$/i.test(file.name || '');

export function formatLabel(video: { type?: string; name?: string }): string {
  if (/quicktime/i.test(video.type || '') || /\.mov$/i.test(video.name || '')) return 'MOV';
  if (/mp4/i.test(video.type || '') || /\.mp4$/i.test(video.name || '')) return 'MP4';
  return '—';
}

export const near = (width: number, height: number, ratio: number): boolean =>
  width > 0 && height > 0 && Math.abs(width / height - ratio) < 0.02;

export function ratioLabel(width: number, height: number): string {
  if (!width || !height) return '—';
  if (near(width, height, 16 / 9)) return '16:9';
  if (near(width, height, 9 / 16)) return '9:16';
  if (near(width, height, 1)) return '1:1';
  return `${decimal(width / height, 2)}:1`;
}

export const destinationOf = (video: { destination?: unknown } | null | undefined): Destination =>
  video?.destination === 'ads' ? 'ads' : 'listing';

export const languageLabel = (code: string): string => (LANGUAGES.find(([id]) => id === code) || LANGUAGES[0])[1];

export const stripHTML = (html: unknown): string =>
  String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Corta en la última palabra que cabe, sin puntos suspensivos ni caracteres partidos. */
export function clip(text: unknown, max: number): string {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max + 1).join('');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : chars.slice(0, max).join('')).replace(/[\s,;:.·-]+$/, '');
}

/** Longitud en caracteres visibles (emojis y tildes cuentan uno). */
export const charCount = (text: unknown): number => Array.from(String(text || '')).length;

export function currencyOf(code: unknown): string {
  const value = String(code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : '';
}

/** Importe con su moneda en es-ES («4,48 €»); vacío si no hay importe. */
export function money(charged: Partial<Charged> | { amount?: unknown; currency?: unknown } | null | undefined): string {
  if (charged == null) return '';
  const raw = (charged as { amount?: unknown }).amount;
  const amount = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(amount)) return '';
  const given = (charged as { currency?: unknown }).currency;
  const currency = currencyOf(given || 'EUR');
  if (!currency) return `${decimal(amount, 2)} ${String(given).trim()}`;
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
  } catch {
    return `${decimal(amount, 2)} ${currency}`;
  }
}

/** «1 vídeo» / «2 vídeos». */
export const videoCount = (count: number): string => `${count} vídeo${count === 1 ? '' : 's'}`;
