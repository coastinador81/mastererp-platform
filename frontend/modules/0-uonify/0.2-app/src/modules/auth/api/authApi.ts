import { recoverMockWorker } from '@/shared/mocks/recover';
import { USE_MOCKS } from '@/shared/api/config';
import { api, ApiError } from '@/shared/api/client';
import { parseConsents } from '../model/legal';
import { parseChatGPTPlan, parseSession } from '../model/session';
import type {
  AuthConfig,
  AuthSession,
  ChatGPTPlanStatus,
  ConsentId,
  ConsentRecord,
  EmailStartResponse,
  EmailVerifyResponse,
  OAuthProvider,
  PlanConnectResponse,
  Profile,
  ProfileSaveResponse,
  SessionPayload,
  StartRequest,
  StartResponse,
} from '../model/types';

/**
 * Contrato del backend para el acceso (rutas bajo API_BASE). El backend es dueño
 * de OAuth, los tokens y la vuelta de OpenAI y Google; la sesión viaja en una
 * cookie HttpOnly. Ver README.md del módulo.
 */
export const AUTH_ENDPOINTS = Object.freeze({
  config: '/auth/config',
  start: (provider: OAuthProvider) => `/auth/${provider}/start`,
  emailStart: '/auth/email/start',
  emailVerify: '/auth/email/verify',
  session: '/auth/session',
  profile: '/profile',
  consents: '/auth/consents',
  chatgptPlan: '/auth/chatgpt/plan',
  logout: '/auth/logout',
});

// Igual que el prototipo: ninguna llamada del acceso espera más de 10 s.
const TIMEOUT_MS = 10_000;
const timeout = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;

async function readAuthConfig(): Promise<AuthConfig> {
  const config = await api.get<AuthConfig>(AUTH_ENDPOINTS.config, { signal: timeout(), headers: { 'Cache-Control': 'no-cache' } });
  if (!config || (config.mode !== 'preview' && config.mode !== 'redirect')) throw new Error('auth-config-invalid');
  return config;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    return await readAuthConfig();
  } catch (error) {
    if (!USE_MOCKS) throw error;
    // Una respuesta HTML del servidor de desarrollo o un fallo temporal no debe
    // convertirse en un redirect de OAuth ni dejar el acceso atascado en caché.
    await recoverMockWorker();
    return readAuthConfig();
  }
}

export async function fetchSessionState(): Promise<{ session: AuthSession; confirmedSignedOut: boolean }> {
  const payload = await api.get<SessionPayload>(AUTH_ENDPOINTS.session, { signal: timeout() });
  return { session: parseSession(payload), confirmedSignedOut: payload?.authenticated === false };
}

export async function fetchSession(): Promise<AuthSession> {
  return (await fetchSessionState()).session;
}

export function startOAuthAccess(provider: OAuthProvider, body: StartRequest): Promise<StartResponse> {
  return api.post<StartResponse>(AUTH_ENDPOINTS.start(provider), body, { signal: timeout() });
}

/** «Continuar con ChatGPT» (nombre del prototipo). */
export const startChatGPTAccess = (body: StartRequest): Promise<StartResponse> => startOAuthAccess('chatgpt', body);

/** Envía un código de 6 dígitos al correo. */
export function startEmailAccess(email: string): Promise<EmailStartResponse> {
  return api.post<EmailStartResponse>(AUTH_ENDPOINTS.emailStart, { email }, { signal: timeout() });
}

/** Comprueba el código; si es correcto, el backend abre la sesión. */
export function verifyEmailCode(email: string, code: string): Promise<EmailVerifyResponse> {
  return api.post<EmailVerifyResponse>(AUTH_ENDPOINTS.emailVerify, { email, code }, { signal: timeout() });
}

/** Guarda el perfil al terminar el alta (exige las condiciones aceptadas). */
export function saveProfile(profile: Profile): Promise<ProfileSaveResponse> {
  return api.post<ProfileSaveResponse>(AUTH_ENDPOINTS.profile, profile, { signal: timeout() });
}

export async function fetchConsents(): Promise<ConsentRecord[]> {
  const result = await api.get<{ consents?: unknown }>(AUTH_ENDPOINTS.consents, { signal: timeout() });
  return parseConsents(result?.consents);
}

/** Acepta documentos en su versión actual; devuelve todas las aceptaciones. */
export async function acceptConsents(items: Array<{ id: ConsentId; version: string }>): Promise<ConsentRecord[]> {
  const result = await api.post<{ consents?: unknown }>(AUTH_ENDPOINTS.consents, { consents: items }, { signal: timeout() });
  return parseConsents(result?.consents);
}

export async function fetchChatGPTPlan(): Promise<ChatGPTPlanStatus> {
  const result = await api.get<{ plan?: unknown }>(AUTH_ENDPOINTS.chatgptPlan, { signal: timeout() });
  return parseChatGPTPlan(result?.plan);
}

/** Pide el permiso del plan de ChatGPT: preview lo concede; en real devuelve la URL de OpenAI. */
export function requestChatGPTPlan(returnTo: string, consentVersion: string): Promise<PlanConnectResponse> {
  return api.post<PlanConnectResponse>(AUTH_ENDPOINTS.chatgptPlan, { returnTo, consentVersion }, { signal: timeout() });
}

export async function revokeChatGPTPlan(): Promise<ChatGPTPlanStatus> {
  const result = await api.delete<{ plan?: unknown }>(AUTH_ENDPOINTS.chatgptPlan, { signal: timeout() });
  return parseChatGPTPlan(result?.plan);
}

/** Un fallo de transporte puede ocurrir después de que el servidor cierre la sesión. */
async function sessionIsClosed(): Promise<boolean> {
  try {
    const result = await api.get<SessionPayload>(AUTH_ENDPOINTS.session, {
      signal: timeout(), headers: { 'Cache-Control': 'no-cache' },
    });
    // Exigir una respuesta explícita: un cuerpo vacío o HTML no confirma la salida.
    return result?.authenticated === false;
  } catch (error) {
    return error instanceof ApiError && error.status === 401;
  }
}

function transientLogoutError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) ||
    (error instanceof ApiError && [408, 502, 503, 504].includes(error.status));
}

export async function logout(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await api.post(AUTH_ENDPOINTS.logout, undefined, { signal: timeout() });
      return;
    } catch (error) {
      if (await sessionIsClosed()) return;
      if (attempt === 1 || (!USE_MOCKS && !transientLogoutError(error))) throw error;
      // Una pestaña abierta puede perder la interceptación local y recibir un
      // 404 o HTML de Vite. Reintentar sin recuperar el worker repite el fallo.
      // Nunca sustituir la confirmación del servidor por borrar la sesión visual.
      if (USE_MOCKS) await recoverMockWorker();
    }
  }
}
