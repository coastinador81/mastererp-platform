/**
 * Utilidades de texto para buscar en español: sin tildes ni mayúsculas, palabras
 * vacías fuera y distancia de edición para tolerar erratas.
 */

/** Minúsculas y sin diacríticos («Facturación» → «facturacion»). La ñ pasa a n. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'como', 'con', 'cual', 'cuando', 'de', 'del', 'donde', 'el', 'en', 'es', 'esta', 'este', 'esto',
  'ha', 'hay', 'la', 'las', 'le', 'lo', 'los', 'me', 'mi', 'mis', 'muy', 'o', 'para', 'pero', 'por', 'puedo', 'que',
  'quiero', 'se', 'si', 'sin', 'sobre', 'su', 'sus', 'te', 'tengo', 'tu', 'tus', 'un', 'una', 'unos', 'uno', 'y', 'ya',
  'yo', 'hacer', 'hago', 'puede', 'mas', 'son', 'ser',
]);

/** Palabras significativas de un texto, normalizadas (sin palabras vacías). */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1 && !STOPWORDS.has(word));
}

/** Todas las palabras, sin filtrar palabras vacías (para localizar coincidencias). */
export function words(text: string): string[] {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Distancia de Levenshtein con corte: devuelve `max + 1` en cuanto la supera. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/** Erratas admitidas según la longitud de la palabra buscada. */
export function allowedTypos(word: string): number {
  if (word.length >= 8) return 2;
  if (word.length >= 4) return 1;
  return 0;
}

/**
 * Sinónimos: la palabra buscada suma estas otras (ya normalizadas). Cubren cómo
 * pregunta la gente frente a cómo están escritos los artículos.
 */
const SYNONYMS: Record<string, string[]> = {
  '2fa': ['verificacion', 'pasos'],
  mfa: ['verificacion', 'pasos'],
  autenticador: ['verificacion', 'pasos'],
  contrasena: ['codigo', 'entrar'],
  password: ['codigo', 'entrar'],
  login: ['entrar'],
  acceder: ['entrar'],
  iniciar: ['entrar'],
  sesion: ['entrar'],
  devolucion: ['desistimiento', 'reembolso'],
  reembolso: ['desistimiento', 'devolucion'],
  cancelar: ['desistimiento'],
  baja: ['desistimiento', 'borrar'],
  precio: ['planes', 'euros'],
  precios: ['planes', 'euros'],
  cuesta: ['planes', 'euros', 'precio'],
  saldo: ['tokens'],
  creditos: ['tokens'],
  recargar: ['recarga', 'tokens'],
  eliminar: ['borrar', 'borrado'],
  suprimir: ['borrar', 'borrado'],
  rgpd: ['privacidad', 'datos'],
  gdpr: ['privacidad', 'datos'],
  seller: ['amazon'],
  vendedor: ['amazon', 'seller'],
  listing: ['ficha'],
  producto: ['ficha'],
  subir: ['publicar'],
  video: ['video'],
  veo: ['video'],
  soporte: ['contacto', 'ticket'],
  ayuda: ['contacto'],
  persona: ['contacto', 'ticket'],
  llamada: ['videollamada', 'meet'],
  seguridad: ['gpsr', 'verificacion'],
  fabricante: ['gpsr'],
  openai: ['chatgpt'],
  gpt: ['chatgpt'],
  limite: ['limites'],
  gratis: ['gratuito', 'mes'],
};

/** Palabras que añade una palabra buscada por sinónimo (puede estar vacío). */
export function synonymsOf(word: string): string[] {
  return SYNONYMS[word] ?? [];
}
