import { requestChatGPTPlan, revokeChatGPTPlan } from '../api/authApi';
import { planGrantReturnUrl, trustedAuthUrl } from '../model/authUrl';
import { CONSENT_DOCUMENTS, parseConsents } from '../model/legal';
import { parseChatGPTPlan } from '../model/session';
import type { ChatGPTPlanStatus } from '../model/types';
import { setSessionConsents, setSessionPlan } from '../state/session';
import { navigation } from './navigation';

/**
 * Permiso para que Uony use el plan de ChatGPT del cliente (aparte del inicio de
 * sesión). Lo usan el paso 4 del alta y Configuración › Conexiones. Se acepta la
 * versión vigente del texto «Uso de tu plan de ChatGPT» (CHATGPT_PLAN_TERMS).
 */
export type PlanConnectResult = { kind: 'connected'; plan: ChatGPTPlanStatus } | { kind: 'redirected' };

/**
 * Pide el permiso. En modo demostración queda conectado al momento; en real, el
 * navegador va a la pantalla de permiso de OpenAI y vuelve a `returnTo`.
 */
export async function connectChatGPTPlan(returnTo: string = planGrantReturnUrl(window.location.origin)): Promise<PlanConnectResult> {
  const result = await requestChatGPTPlan(returnTo, CONSENT_DOCUMENTS['chatgpt-plan'].version);
  if (result?.authUrl) {
    const target = trustedAuthUrl(result.authUrl, window.location.origin, 'chatgpt');
    if (!target) throw new Error('grant-url-untrusted');
    navigation.hard(target.href);
    return { kind: 'redirected' };
  }
  const plan = parseChatGPTPlan(result?.plan);
  if (plan.status !== 'connected') throw new Error('plan-not-connected');
  setSessionPlan(plan);
  const consents = parseConsents(result?.consents);
  if (consents.length) setSessionConsents(consents);
  return { kind: 'connected', plan };
}

/** «Desconectar»: el backend borra la credencial delegada. Cerrar sesión no lo hace. */
export async function disconnectChatGPTPlan(): Promise<ChatGPTPlanStatus> {
  const plan = await revokeChatGPTPlan();
  setSessionPlan(plan);
  return plan;
}
