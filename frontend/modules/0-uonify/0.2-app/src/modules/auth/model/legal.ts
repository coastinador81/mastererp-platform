import type { ConsentId, ConsentRecord } from './types';

/**
 * Documentos que se aceptan en el alta, con su versión (se guarda la versión y la
 * fecha de cada aceptación). Si cambia un texto, se sube su versión y se vuelve a pedir.
 */
export interface ConsentDocument {
  id: ConsentId;
  version: string;
  /** Nombre del documento en Configuración › Privacidad y legal. */
  title: string;
  /** Página pública del documento, si la tiene. */
  href?: string;
}

export const CONSENT_DOCUMENTS: Readonly<Record<ConsentId, ConsentDocument>> = {
  terms: { id: 'terms', version: '2026-09-27', title: 'Condiciones del servicio', href: '/terminos' },
  privacy: { id: 'privacy', version: '2026-09-27', title: 'Política de privacidad', href: '/privacidad' },
  // Misma versión que la aprobó el abogado del dueño (26-09-2026).
  'ai-third-party': { id: 'ai-third-party', version: '2026-09-26', title: 'Modelos de IA de terceros' },
  'chatgpt-plan': { id: 'chatgpt-plan', version: '2026-09-27', title: 'Uso de tu plan de ChatGPT' },
};

/** Las tres casillas del paso «Condiciones», en su orden. */
export const TERMS_STEP_CONSENTS: readonly ConsentId[] = ['terms', 'privacy', 'ai-third-party'];

/**
 * Cláusula «Modelos de IA de terceros», aprobada por el abogado del dueño el
 * 26-09-2026. Se publica tal cual (la misma de la pestaña Vídeo).
 */
export const AI_CLAUSE_TITLE = 'Modelos de IA de terceros.';
export const AI_CLAUSE_TEXT =
  'Uonify genera vídeos, imágenes y textos con modelos de inteligencia artificial de terceros, como Google u OpenAI. Su disponibilidad, funcionamiento y precio dependen de esos proveedores y pueden cambiar sin previo aviso. Si el modelo previsto no está disponible, Uonify podrá completar la tarea con otro modelo o plataforma disponible para entregarte el resultado solicitado. En ese caso, el saldo consumido corresponderá al modelo utilizado, que puede ser distinto del previsto.';

/** Qué supone conectar el plan de ChatGPT (paso 4 del alta y Configuración › Conexiones). */
export const CHATGPT_PLAN_TERMS: readonly string[] = [
  'Uony usará tu plan de ChatGPT en el chat y en los agentes de Uonify.',
  'Ese uso cuenta para los límites de tu plan de ChatGPT. No consume tokens de Uonify ni tiene recargo.',
  'Las funciones que usan tu plan de ChatGPT nunca pasan a tokens de Uonify sin que lo elijas en ese momento.',
  'Puedes desconectarlo cuando quieras en Configuración › Conexiones. Cerrar sesión no lo desconecta.',
  'Uonify nunca ve tu contraseña ni tus conversaciones de ChatGPT.',
];

/** Texto de la casilla del permiso (se guarda con la versión de «chatgpt-plan»). */
export const CHATGPT_PLAN_CONSENT = 'Autorizo a Uonify a usar mi plan de ChatGPT para Uony en estas condiciones.';

/** Qué paga cada cosa con el plan de ChatGPT conectado (resumen de la tabla por función). */
export interface BillingRow {
  feature: string;
  payer: 'chatgpt' | 'uonify';
}

export const CHATGPT_BILLING_ROWS: readonly BillingRow[] = [
  { feature: 'Chat con Uony y agentes', payer: 'chatgpt' },
  { feature: 'Títulos, viñetas y descripciones desde el chat', payer: 'chatgpt' },
  { feature: 'Botones de Uony en la ficha de producto', payer: 'uonify' },
  { feature: 'Imágenes, auditoría y modelos 3D desde el chat', payer: 'chatgpt' },
  { feature: 'Vídeo', payer: 'uonify' },
];

export const PAYER_LABELS: Record<BillingRow['payer'], string> = {
  chatgpt: 'Tu plan de ChatGPT',
  uonify: 'Tokens de Uonify',
};

/** La aceptación vigente de un documento (de su versión actual), o undefined. */
export function currentConsent(consents: readonly ConsentRecord[], id: ConsentId): ConsentRecord | undefined {
  const version = CONSENT_DOCUMENTS[id].version;
  return consents.find(consent => consent.id === id && consent.version === version);
}

/** Documentos del paso «Condiciones» que faltan por aceptar en su versión actual. */
export function missingConsents(consents: readonly ConsentRecord[], ids: readonly ConsentId[] = TERMS_STEP_CONSENTS): ConsentId[] {
  return ids.filter(id => !currentConsent(consents, id));
}

export const isConsentId = (value: unknown): value is ConsentId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONSENT_DOCUMENTS, value);

/** Normaliza la lista de aceptaciones que llega del backend. */
export function parseConsents(raw: unknown): ConsentRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { id, version, acceptedAt } = item as Record<string, unknown>;
    if (!isConsentId(id) || typeof version !== 'string' || typeof acceptedAt !== 'string') return [];
    return [{ id, version, acceptedAt }];
  });
}

/** «27/09/2026» (fecha de una aceptación, en hora de Madrid). */
export function formatConsentDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }).format(date);
}
