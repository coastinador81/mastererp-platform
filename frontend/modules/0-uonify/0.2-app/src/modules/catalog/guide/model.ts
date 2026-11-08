import type { CatalogProduct, SampleDefinition } from '../model/types';

export const GUIDE_SKU = 'UON-KIT-01';
export const GUIDE_FOLDER = 'Uonify / Make It Possible';
export type GuideStep = 'amazon' | 'drive' | 'folder' | 'files' | 'preparing' | 'ready' | 'preview' | 'publishing' | 'published';
export interface Guide {
  threadId: string;
  step: GuideStep;
  folder: string;
  progress: number;
  paused: boolean;
  busy: boolean;
  error: string;
  reviewed?: string;
  published?: string;
  publicationUrl?: string;
  sku?: string;
}
export interface GuideSource {
  folder: string;
  files: { name: string; kind: string }[];
}
export interface GuidePrepared { product: CatalogProduct; sample: SampleDefinition }
export const normalise = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function startsGuide(text: string): boolean {
  const value = normalise(text);
  return /amazon|jenga|make it possible/.test(value) && /subir|publicar|preparar|crear|vender/.test(value);
}
export function publicationApproved(text: string): boolean {
  // Una frase negativa, condicional o pregunta nunca autoriza un envío.
  const value = normalise(text).replace(/[.,!¡]/g, '').replace(/^(uony|wuni|woni)\s*/, '');
  return /^(?:perfecto\s+)?(?:aprobado\s+)?(?:subelo|publicalo|publicar en amazon|aprobar y publicar|publica los cambios|actualiza la publicacion)$/.test(value);
}
export function editFromText(text: string): Partial<CatalogProduct> | null {
  const price = normalise(text).match(/(?:cambia|pon|poner|baja|sube|actualiza).*?precio\s+(?:a\s+|en\s+)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:€|euros?))?[.!]?$/);
  if (price && Number(price[1].replace(',', '.')) > 0) return { price: Number(price[1].replace(',', '.')).toFixed(2) };
  const title = text.match(/(?:cambia|pon|actualiza)\s+(?:el\s+)?t[íi]tulo\s+(?:a|por)\s+[“"]?(.+?)[”"]?$/i);
  if (title?.[1].trim()) return { name: title[1].trim() };
  return null;
}
