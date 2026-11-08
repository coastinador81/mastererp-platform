import { isASIN, isEAN } from '../../model/scrape';

/**
 * Simulación: qué producto «encuentra» el backend para una URL, ASIN o EAN.
 * Palabras de la URL → perfil; un ASIN o EAN sin pistas → un perfil fijo por código
 * (la misma entrada da siempre el mismo producto); cualquier otra URL → producto genérico.
 */
export type ProfileId = 'make-it-possible' | 'frigorifico' | 'televisor' | 'smartphone' | 'lavadora' | 'generic';

const KEYWORDS: Array<[ProfileId, RegExp]> = [
  ['make-it-possible', /uonify|make-?it-?possible|uon-kit/],
  ['frigorifico', /frigorif|nevera|combi|refrigera/],
  ['televisor', /televis|smart-?tv|\btv\b|oled|qled/],
  ['smartphone', /smartphone|movil|telefono|iphone|galaxy|android/],
  ['lavadora', /lavadora|lavado|washer/],
];

const BY_CODE: ProfileId[] = ['make-it-possible', 'frigorifico', 'televisor', 'smartphone', 'lavadora'];

/** Minúsculas y sin tildes («Frigorífico» → «frigorifico»). */
export const normalizeInput = (input: string): string =>
  input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

export function detectProfile(input: string): ProfileId {
  const text = normalizeInput(input);
  const found = KEYWORDS.find(([, pattern]) => pattern.test(text));
  if (found) return found[0];
  const code = input.trim().toUpperCase();
  if (isEAN(code) || isASIN(code)) return BY_CODE[hash(code) % BY_CODE.length];
  return 'generic';
}

/** Lo que el servicio sabe analizar: una URL (o dominio), un ASIN o un EAN. */
export function isAnalyzableInput(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (isEAN(text) || isASIN(text)) return true;
  if (/^https?:\/\//i.test(text)) {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  }
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text);
}

export interface PageInfo {
  host: string;
  brand: string;
  title: string;
}

const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Dominio, marca y título que se deducen de una URL (producto genérico). */
export function pageInfo(input: string): PageInfo {
  let url: URL | null;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    url = null;
  }
  const host = url ? url.hostname.replace(/^www\./, '') : input.trim();
  const brand = capitalize(host.split('.')[0] ?? host);
  const segment = url
    ? decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.(html?|php|aspx?)$/i, '')
    : '';
  const words = segment.replace(/[-_+]+/g, ' ').replace(/\b(p|dp|producto|product|item)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const title = words && /[a-z]/i.test(words) ? capitalize(words) : `Producto de ${host}`;
  return { host, brand, title };
}
