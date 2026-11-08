import { missingConsents } from './legal';
import { STEP_INDEX } from './options';
import { isAdultAgeRange } from './profile';
import type { AuthProvider, ConsentRecord, ProfileValues } from './types';

/** Alta por proveedor: condiciones primero; ChatGPT autoriza su plan en ese mismo paso. */

/** Decisión sobre el permiso: conectar el plan de ChatGPT o seguir sin él. */
export type ChatGPTChoice = 'connect' | 'skip' | '';

export const youComplete = (values: ProfileValues): boolean =>
  !!values.firstName.trim() && !!values.lastName.trim() && isAdultAgeRange(values.ageRange);

export const workComplete = (values: ProfileValues): boolean => !!values.role && !!values.companySize && !!values.primaryGoal;

export interface ResumeInput {
  provider?: AuthProvider | null;
  values: ProfileValues;
  consents: readonly ConsentRecord[];
  chatgptConnected: boolean;
  chatgptChoice: ChatGPTChoice;
  /** Índice estable del paso guardado; done si no existe borrador. */
  savedStep: number;
}

/** Índices estables para conservar borradores anteriores; cambia solo el recorrido. */
export function onboardingOrder(provider: AuthProvider | null): readonly number[] {
  return provider === 'chatgpt'
    ? [STEP_INDEX.terms, STEP_INDEX.you, STEP_INDEX.work, STEP_INDEX.plan, STEP_INDEX.done]
    : [STEP_INDEX.terms, STEP_INDEX.you, STEP_INDEX.work, STEP_INDEX.chatgpt, STEP_INDEX.plan, STEP_INDEX.done];
}

/** Retoma el paso guardado sin saltarse condiciones, permisos o datos pendientes. */
export function resumeStep({ values, consents, chatgptConnected, chatgptChoice, savedStep, provider = null }: ResumeInput): number {
  const order = onboardingOrder(provider);
  const pending: Record<number, boolean> = {
    [STEP_INDEX.terms]: missingConsents(consents).length > 0 || (provider === 'chatgpt' && !chatgptConnected && chatgptChoice !== 'skip'),
    [STEP_INDEX.you]: !youComplete(values),
    [STEP_INDEX.work]: !workComplete(values),
    [STEP_INDEX.chatgpt]: !chatgptConnected && !chatgptChoice,
    [STEP_INDEX.plan]: true,
  };
  const firstPending = order.findIndex(step => pending[step]);
  // Al volver del permiso, las condiciones ya están guardadas: sigue con el perfil.
  if (provider === 'chatgpt' && chatgptConnected && savedStep === STEP_INDEX.terms && !pending[STEP_INDEX.terms]) return order[firstPending];
  const savedPosition = order.indexOf(savedStep);
  return order[Math.min(savedPosition < 0 ? 0 : savedPosition, firstPending)];
}

/** Ayuda del correo bloqueado según el proveedor (requisito F1 de la revisión). */
export function lockedEmailHelp(provider: AuthProvider | null): string {
  if (provider === 'chatgpt') return 'Es el correo de tu cuenta de ChatGPT.';
  if (provider === 'google') return 'Es el correo de tu cuenta de Google.';
  if (provider === 'email') return 'Es el correo que has verificado con el código.';
  return 'Correo vinculado a tu cuenta.';
}

/** Nombre y apellidos a partir del nombre que da el proveedor («Ana García López»). */
export function splitName(full: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = full.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

/** Entradilla del paso 4: con ChatGPT es un permiso aparte; con Google o correo, una recomendación. */
export function chatgptStepIntro(provider: AuthProvider | null): string {
  if (provider === 'chatgpt') {
    return 'Ya has entrado con ChatGPT. Este es un permiso aparte: si lo concedes, Uony trabajará con tu plan de ChatGPT.';
  }
  return 'Uony puede trabajar con tu plan de ChatGPT sin coste añadido en Uonify. Si prefieres no conectarlo, Uony usará tokens de Uonify, que necesitan un plan de pago.';
}
