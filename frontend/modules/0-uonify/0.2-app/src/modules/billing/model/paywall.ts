import type { PlanRequiredCode, PlanRequiredDetail } from '@/shared/api/planRequired';

/**
 * Textos del muro de pago. El backend responde 402 con `feature` (qué intentaba
 * hacer el cliente); aquí se traduce a una frase para explicar por qué se pide un
 * plan o una recarga. Nunca se cambia de forma de pago en silencio: el aviso solo
 * ofrece opciones y el cliente elige.
 */
const FEATURES: Record<string, string> = {
  video: 'crear vídeos con Uony',
  aplus: 'crear contenido A+',
  '3d': 'crear modelos 3D',
  model3d: 'crear modelos 3D',
  download: 'descargar contenido del catálogo',
  export: 'descargar contenido del catálogo',
  images: 'crear imágenes con Uony',
  descriptions: 'escribir descripciones con Uony',
  audit: 'auditar fichas con Uony',
  chat: 'hablar con Uony',
  uony: 'usar Uony',
  'product-ai': 'usar los botones de Uony de la ficha',
  automation: 'usar las automatizaciones',
  agents: 'usar los agentes',
  seats: 'invitar a más personas',
  support_call: 'reservar una videollamada de soporte',
};

/** Frase de la función: «crear vídeos con Uony». Sin dato, «usar esta función». */
export function featureLabel(feature?: string): string {
  if (!feature) return 'usar esta función';
  return FEATURES[feature] ?? 'usar esta función';
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Funciones que puede pagar el plan de ChatGPT del cliente (chat, descripciones,
 * imágenes, auditoría, 3D y automatizaciones). El vídeo y los botones de la ficha
 * van siempre con tokens de Uonify.
 */
const CHATGPT_FEATURES = new Set(['chat', 'uony', 'descriptions', 'images', 'audit', '3d', 'model3d', 'automation', 'agents']);

export function chatGptCanCover(feature?: string): boolean {
  return feature !== undefined && CHATGPT_FEATURES.has(feature);
}

export interface PaywallCopy {
  code: PlanRequiredCode;
  title: string;
  lead: string;
  /** Mensaje del servidor si añade algo al texto propio. */
  detail: string | null;
  /** Ofrecer «Conectar ChatGPT» (solo en tokens_required y si ayuda). */
  offerChatGpt: boolean;
}

/**
 * Textos del aviso. `chatGptConnected`: null si no se sabe; con ChatGPT ya
 * conectado no se ofrece conectarlo otra vez.
 */
export function paywallCopy(detail: PlanRequiredDetail, chatGptConnected: boolean | null): PaywallCopy {
  const label = featureLabel(detail.feature);
  const message = detail.message?.trim() || null;
  if (detail.code === 'tokens_required') {
    return {
      code: 'tokens_required',
      title: 'Recarga tokens de Uonify',
      lead: `Para ${label} hacen falta tokens de Uonify y ahora no tienes suficientes.`,
      detail: message,
      offerChatGpt: chatGptCanCover(detail.feature) && chatGptConnected !== true,
    };
  }
  return {
    code: 'plan_required',
    title: `Necesitas un plan para ${label}`,
    lead: `Uonify es gratis para empezar. ${capitalize(label)} tiene un coste para Uonify, así que forma parte de los planes de pago.`,
    detail: message,
    offerChatGpt: false,
  };
}

/** Mismo aviso (para no abrir dos veces el mismo por peticiones seguidas). */
export function samePaywall(a: PlanRequiredDetail | null | undefined, b: PlanRequiredDetail): boolean {
  return !!a && a.code === b.code && (a.feature ?? '') === (b.feature ?? '');
}
