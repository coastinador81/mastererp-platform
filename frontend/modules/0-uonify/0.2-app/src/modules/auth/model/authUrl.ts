import type { OAuthProvider } from './types';

/** Hosts a los que se permite redirigir para iniciar sesión, por proveedor (solo https). */
export const TRUSTED_AUTH_HOSTS: Readonly<Record<OAuthProvider, readonly string[]>> = {
  chatgpt: ['chatgpt.com', 'auth.openai.com'],
  google: ['accounts.google.com'],
};

/**
 * Devuelve la URL de acceso si es de confianza: el mismo origen de Uonify o
 * https en un host del proveedor (prototipo: startChatGPT). Si no, null.
 */
export function trustedAuthUrl(raw: unknown, origin: string, provider: OAuthProvider = 'chatgpt'): URL | null {
  if (typeof raw !== 'string' || !raw) return null;
  let target: URL;
  try {
    target = new URL(raw, origin);
  } catch {
    return null;
  }
  const sameOrigin = target.origin === new URL(origin).origin;
  const trusted = target.protocol === 'https:' && TRUSTED_AUTH_HOSTS[provider].includes(target.hostname);
  return sameOrigin || trusted ? target : null;
}

/** El backend vuelve aquí tras el acceso en el proveedor (prototipo: index.html?auth=return). */
export function authReturnUrl(origin: string): string {
  return new URL('/?auth=return', origin).href;
}

/** Vuelta del permiso del plan de ChatGPT (paso 4 del alta). */
export function planGrantReturnUrl(origin: string): string {
  return new URL('/?auth=return&grant=chatgpt-plan', origin).href;
}

export const isAuthReturn = (search: string): boolean => new URLSearchParams(search).get('auth') === 'return';

/**
 * Mensaje propio para cada error de la vuelta (?auth=return&error=…). El backend
 * tipifica el error; un código desconocido usa el texto genérico.
 */
const RETURN_ERRORS: Record<string, string> = {
  access_denied: 'Has cancelado el acceso. Puedes intentarlo de nuevo cuando quieras.',
  consent_declined: 'No has concedido el permiso. Puedes intentarlo de nuevo cuando quieras.',
  org_blocked: 'Tu organización no permite entrar en Uonify con esta cuenta. Prueba con otra forma de acceso.',
  age_restricted: 'Uonify está disponible solo para personas de 18 años o más.',
  account_disabled: 'Esta cuenta está desactivada. Escríbenos a hola@uonify.com.',
  invite_email_mismatch: 'Entra con la cuenta del correo al que llegó la invitación.',
};

export const RETURN_ERROR_FALLBACK = 'El acceso no se ha completado. Puedes intentarlo de nuevo.';

/** Error de la vuelta, o null si no lo hay. */
export function authReturnError(search: string): string | null {
  const code = new URLSearchParams(search).get('error');
  if (!code) return null;
  return RETURN_ERRORS[code] ?? RETURN_ERROR_FALLBACK;
}

/** La vuelta es la del permiso del plan de ChatGPT (no la del inicio de sesión). */
export const isPlanGrantReturn = (search: string): boolean => new URLSearchParams(search).get('grant') === 'chatgpt-plan';

/** Mensajes de la vuelta del permiso del plan (paso 4 del alta). */
export function planGrantReturnError(search: string): string | null {
  const code = new URLSearchParams(search).get('error');
  if (!code) return null;
  if (code === 'access_denied' || code === 'consent_declined') {
    return 'No has concedido el permiso en ChatGPT. Puedes conectarlo ahora o más tarde en Configuración › Conexiones.';
  }
  if (code === 'org_blocked') return 'Tu organización no permite conectar este plan de ChatGPT. Uony puede usar tokens de Uonify.';
  return 'No se pudo conectar tu plan de ChatGPT. Inténtalo de nuevo.';
}
