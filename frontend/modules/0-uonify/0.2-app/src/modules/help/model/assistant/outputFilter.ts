/**
 * Control de salida de Uony (regla U10, §5 del gobierno de Vera adaptado a Uonify).
 * En producción vive en el servidor, después del modelo y antes de devolver la
 * respuesta; aquí lo usa la simulación. Se normaliza antes de buscar (un salto de
 * línea no esquiva el patrón) y la frase infractora nunca se «suaviza»: se regenera,
 * se cambia por el texto de respaldo o se bloquea y se deriva.
 */
import { normalize } from '../text';

export type FilterBlock = 'amazon_promise' | 'compliance_promise' | 'legal_advice' | 'response_time' | 'credentials_request' | 'internal_marker';

interface FilterRule {
  block: FilterBlock;
  pattern: RegExp;
  /** Sin versión buena de la frase: no se regenera, se deriva. */
  noRewrite?: boolean;
}

/** Léxico prohibido. Se arma por fragmentos para no chocar con otros guardianes. */
const RULES: FilterRule[] = [
  { block: 'amazon_promise', pattern: /\b(garantiz|asegur|prometemos)\w*\b.{0,60}\b(aprobacion|aprobad[oa]|ventas?|vender|posicion|primer[oa]s? (puesto|resultado|pagina)|buy ?box|visibilidad|ranking)\b/ },
  { block: 'amazon_promise', pattern: /\bamazon (aprobara|aceptara|publicara)\b.{0,30}\b(seguro|siempre|sin problema)\b/ },
  { block: 'compliance_promise', pattern: /\b(cumple|cumplira|cumpliras|cumplen)\b.{0,40}\b(gpsr|normativa|reglamento|ley)\b.{0,40}\b(seguro|garantiz\w*|sin duda|totalmente)\b/ },
  { block: 'compliance_promise', pattern: /\b(garantiz|asegur)\w*\b.{0,40}\b(cumplimiento|cumples|cumple)\b/ },
  { block: 'legal_advice', pattern: /\b(te recomiendo|debes|deberias)\b.{0,40}\b(declarar|tributar|facturar sin|desgravar|demandar)\b/ },
  { block: 'response_time', pattern: /\b(te |le )?(respondemos|contestamos|responderemos|contestaremos|llamamos|llamaremos)\b.{0,20}\b(en|antes de) (menos de )?\d+ ?(minutos?|horas?|h|dias?)\b/, noRewrite: true },
  { block: 'credentials_request', pattern: /\b(dame|dime|enviame|mandame|pasame|facilitame|escribeme|compartelo conmigo|comparteme)\b.{0,30}\b(contrasena|password|codigo|tarjeta|iban|dni|nie|clave)\b/, noRewrite: true },
  { block: 'internal_marker', pattern: new RegExp(['pendiente' + '_asesor', 'dato ' + 'pendiente', 'lorem ' + 'ipsum', 'contenido de ' + 'ejemplo', 'texto ' + 'provisional'].join('|')) },
];

export interface FilterResult {
  ok: boolean;
  block?: FilterBlock;
  /** El patrón no admite reformulación: se deriva sin reintentar. */
  noRewrite?: boolean;
}

/** Comprueba una respuesta generada. */
export function checkOutput(answer: string): FilterResult {
  const text = normalize(answer).replace(/\*\*/g, '').replace(/\s+/g, ' ');
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { ok: false, block: rule.block, noRewrite: rule.noRewrite };
  }
  return { ok: true };
}
