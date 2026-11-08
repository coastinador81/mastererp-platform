import type { Issue, IssueLevel, Plan, Shot } from './types';

/**
 * Revisión de los textos del guion con las normas de vídeo de Amazon (ficha y
 * anuncios) (prototipo: pim/video.js). Lo que Amazon rechaza bloquea la generación
 * (error); el resto es un consejo (warn). Palabras completas en castellano
 * (\b no reconoce las letras con tilde).
 */
interface Rule {
  level: IssueLevel;
  message: string;
  test: (text: string) => boolean;
}

const word = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');

const PRICE = word('\\d+(?:[.,]\\d+)?\\s?(?:eur|euros?|usd|d[oó]lares?|gbp|libras?)|(?:eur|usd|gbp|pvp)\\.?\\s?\\d+(?:[.,]\\d+)?|precios?|pvp');
const OFFER = word('[-−–]\\s?\\d+(?:[.,]\\d+)?\\s?%|\\d+(?:[.,]\\d+)?\\s?%\\s*(?:de\\s+)?(?:dto\\.?|descuento|menos|rebaja)|(?:ahorra|ahorro de|descuento de|dto\\.?)\\s*(?:un\\s+|hasta\\s+(?:un\\s+)?)?\\d+(?:[.,]\\d+)?\\s?(?:%|€|euros?)|descuentos?|rebajas|rebajad[oa]s?|ofertas?|ofert[oó]n|promoci[oó]n(?:es)?|promos?|gratis|gratuit[oa]s?|sin gastos de env[ií]o|cup[oó]n(?:es)?|chollos?|gangas?|liquidaci[oó]n|outlet|black friday|cyber monday|\\d\\s?x\\s?\\d(?!\\s?(?:cm|mm|m|px|in)(?![\\p{L}]))');
const CALL = word('c[oó]mpral[oa]s?|compra (?:ya|ahora|hoy)|p[ií]del[oa]s?|a[nñ][aá]del[oa]s?|añade al carrito|cons[ií]guel[oa]s?|cons[ií]gue(?:lo)? (?:ya|ahora|hoy)|ll[eé]vatel[oa]s?|hazte con el tuyo|aprovecha (?:ya|ahora|la oferta|esta oferta)|date prisa|vis[ií]tanos|visita (?:nuestra|la web|la tienda)|s[ií]guenos|(?:haz )?clic aqu[ií]|pulsa aqu[ií]|haz clic|solo (?:por )?hoy|hasta agotar existencias|stock limitado|[uú]ltimas unidades|por tiempo limitado|no te lo pierdas');
const CONTACT = /https?:\/\/|www\.|[\p{L}\d-]+\.(?:com|es|net|org|shop|store|eu|de|fr|it|io|info|app|co\.uk)(?![\p{L}])|@[\p{L}\d_]{2,}|(?<!(?:ref\.?|referencia|modelo|mod\.)\s*)(?<![\p{L}\p{N}])(?:\+\d{2}\s?)?[6-9](?:[\s.]?\d){8}(?![\p{N}])/iu;
const REVIEWS = word('\\d(?:[.,]\\d)?\\s*estrellas?|(?:cinco|cuatro|tres) estrellas de valoraci[oó]n|rese[nñ]as?|valoraci[oó]n(?:es)?(?: de (?:los )?clientes)?|opiniones de (?:los )?clientes');
const AMAZON = word("amazon(?:'s choice)?|prime|best ?sellers?|m[aá]s vendid[oa]s?|top ventas|superventas|[eé]xito de ventas|n(?:[uú]mero|\\.?º) ?1 en ventas");
const SUPERLATIVE = word('(?:el|la|los|las) mejor(?:es)?|n[uú]mero 1|n\\.?º ?1');
const CHILDREN = word('niñ[oa]s?|bebés?|menores de edad|chiquill[oa]s?|crías|hij[oa]s?|peques?|adolescentes?|alumn[oa]s?|colegiales');
const FAMILY = word('familias?|familiar(?:es)?');

const CONTACT_RULE: Rule = { level: 'error', message: 'Quita enlaces, correos o teléfonos.', test: text => CONTACT.test(text) };

const TEXT_RULES: Rule[] = [
  { level: 'error', message: 'Quita el precio: Amazon no admite precios en el vídeo.', test: text => /\d\s?(?:€|\$|£)|[€$£]\s?\d/u.test(text) || PRICE.test(text) },
  { level: 'error', message: 'Quita la oferta o el descuento: Amazon no los admite.', test: text => OFFER.test(text) },
  { level: 'error', message: 'Quita la llamada a comprar o la urgencia.', test: text => CALL.test(text) },
  CONTACT_RULE,
  { level: 'error', message: 'Quita reseñas y valoraciones.', test: text => /★|⭐|\d(?:[.,]\d)?\s*\/\s*5(?!\d)/u.test(text) || REVIEWS.test(text) },
  { level: 'error', message: 'Quita las marcas y distintivos de Amazon.', test: text => AMAZON.test(text) },
];
const ADVICE_RULES: Rule[] = [
  { level: 'warn', message: 'Evita superlativos que no puedas demostrar.', test: text => SUPERLATIVE.test(text) },
  { level: 'warn', message: 'Evita escribirlo todo en mayúsculas.', test: text => (text.match(/\p{Lu}/gu) || []).length >= 4 && text === text.toLocaleUpperCase('es') },
];
const ACTION_RULES: Rule[] = [
  { level: 'error', message: 'En la UE, Veo no genera niños: describe adultos o solo el producto.', test: text => CHILDREN.test(text) },
  { level: 'warn', message: 'Si aparece una familia, que sean solo adultos: Veo no genera niños en la UE.', test: text => FAMILY.test(text) },
  CONTACT_RULE,
];

const runRules = (rules: Rule[], text: unknown): Issue[] =>
  String(text || '').trim() ? rules.filter(rule => rule.test(String(text))).map(({ level, message }) => ({ level, message })) : [];

/** Texto en pantalla o lema: normas de Amazon y consejos. */
export const lintText = (text: unknown): Issue[] => runRules([...TEXT_RULES, ...ADVICE_RULES], text);

type LintableShot = Pick<Shot, 'action' | 'text'> & { image?: { url?: string } | null };

export function lintShot(shot: LintableShot): Issue[] {
  const issues: Issue[] = [];
  if (!shot.image?.url) issues.push({ level: 'error', message: 'Elige una foto para este plano.', field: 'image' });
  if (!String(shot.action || '').trim()) issues.push({ level: 'error', message: 'Describe qué pasa en el plano.', field: 'action' });
  runRules(ACTION_RULES, shot.action).forEach(issue => issues.push({ ...issue, field: 'action' }));
  lintText(shot.text).forEach(issue => issues.push({ ...issue, field: 'text' }));
  return issues;
}

export const lintClosing = (closing: { tagline?: string } | null | undefined): Issue[] =>
  lintText(closing?.tagline).map(issue => ({ ...issue, field: 'tagline' as const }));

export function planIssues(plan: { shots: (LintableShot & Pick<Shot, 'id'>)[]; closing?: Plan['closing'] | null }): Issue[] {
  const issues: Issue[] = [];
  plan.shots.forEach(shot => lintShot(shot).forEach(issue => issues.push({ ...issue, shot: shot.id })));
  lintClosing(plan.closing).forEach(issue => issues.push({ ...issue, shot: 'closing' }));
  return issues;
}
