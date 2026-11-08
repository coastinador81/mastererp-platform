/**
 * Intención de un mensaje para Uony de soporte: saludos, preguntas sobre si es una
 * persona, intentos de saltarse las reglas (U6) y los casos de derivación (U7).
 * Se comprueba sobre el texto normalizado (sin tildes ni mayúsculas).
 */
import { normalize } from '../text';

export type Intent =
  | 'injection'
  | 'data_rights'
  | 'complaint'
  | 'human'
  | 'account_specific'
  | 'identity'
  | 'greeting'
  | 'thanks'
  | 'question';

const PATTERNS: Array<[Intent, RegExp]> = [
  ['injection', /\b(ignora|olvida|salta(te)?)\b.{0,40}\b(instrucciones|reglas|normas|indicaciones)\b|\b(system prompt|prompt del sistema|modo desarrollador|developer mode|jailbreak)\b|\b(revela|muestra|ensename|dime)\b.{0,30}\b(prompt|instrucciones)\b|\bactua como\b|\bsoy (del|de el) equipo de uonify\b/],
  ['data_rights', /\b(borr|elimin|supri)\w*\b.{0,30}\b(mis datos|datos personales|mi cuenta|toda mi informacion)\b|\bderecho (de|a la?) (acceso|supresion|rectificacion|oposicion|portabilidad|olvido)\b|\b(rgpd|gdpr|lopd|proteccion de datos)\b/],
  ['complaint', /\b(reclamacion|reclamar|queja|quejarme|denuncia|denunciar|estafa|timo|indignad[oa]|vergonzoso|inaceptable|hoja de reclamaciones)\b/],
  ['human', /\b(hablar|habla|pasame|pasar|contactar|comunicarme)\b.{0,30}\b(persona|humano|agente|alguien|equipo|soporte|operador)\b|\b(persona real|un humano|agente humano|atencion al cliente)\b/],
  ['account_specific', /\b(me (habeis|han) cobrado|cobro (doble|duplicado|indebido)|cargo (no reconocido|duplicado)|no reconozco (el|un|este) cargo|cuenta (bloqueada|suspendida)|me (habeis|han) bloqueado|no me (ha llegado|llega) (el reembolso|la devolucion)|devolvedme)\b/],
  ['identity', /\b(eres|seras|es esto) (una |un )?(persona|humano|humana|bot|robot|ia|inteligencia artificial|maquina)\b|\b(hablo con|estoy hablando con) (una |un )?(persona|humano|bot|maquina|ia)\b/],
  ['greeting', /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos)[\s!.,¡]*$/],
  ['thanks', /^(muchas )?(gracias|genial|perfecto|vale|ok|de acuerdo)[\s!.,]*(gracias)?[\s!.,]*$/],
];

/** Intención principal de un mensaje (las más graves primero). */
export function detectIntent(message: string): Intent {
  const text = normalize(message).replace(/\s+/g, ' ').trim();
  for (const [intent, pattern] of PATTERNS) if (pattern.test(text)) return intent;
  return 'question';
}
