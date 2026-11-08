import { ApiError } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { acceptConsents, saveProfile } from '../api/authApi';
import { clearDraft, readDraft, writeDraft } from '../model/draft';
import { CONSENT_DOCUMENTS, currentConsent, missingConsents } from '../model/legal';
import { onboardingOrder, resumeStep, splitName } from '../model/onboarding';
import { PROFILE_STEP_COUNT, STEP_INDEX } from '../model/options';
import { checkProfile, profileFromValues, valuesFromProfile } from '../model/profile';
import { getUi, patchProfile, patchUi, requestFocus, setSurface } from '../state/authUi';
import { currentSession, markProfileReady, setSessionConsents } from '../state/session';
import { connectChatGPTPlan } from './chatgptPlan';
import { restoreFocus } from './focus';
import { HOME_PATH, navigation } from './navigation';
import { transitionToWorkspace } from './workspace';

/** Alta por proveedor: condiciones primero; ChatGPT autoriza su plan en ese mismo paso. */

/** Control que recibe el foco en cada paso (marcado con data-step-focus). */
export const stepFocus = (step: number) => `[data-onboard-step="${step}"] [data-step-focus]`;

// Mensaje para el alta al volver del permiso del plan de ChatGPT (lo pone boot).
let pendingStatus = '';

export function setPendingProfileStatus(message: string | null): void {
  pendingStatus = message ?? '';
}

function saveDraft(step: number): void {
  if (currentSession().onboardingStage === 'profile') return;
  const { values, chatgptChoice } = getUi().profile;
  writeDraft({ email: currentSession().email, step, values, chatgptChoice });
}

function goToStep(step: number, status = ''): void {
  const next = Math.min(Math.max(0, step), PROFILE_STEP_COUNT - 1);
  patchProfile({ step: next, status, saving: false });
  saveDraft(next);
  requestFocus(stepFocus(next));
}

/** Abre el alta con lo guardado y la retoma en el paso pendiente (prototipo: showProfile). */
export function showProfile(): void {
  setSurface(USE_MOCKS);
  const session = currentSession();
  const draft = session.onboardingStage === 'profile' ? null : readDraft(session.email);
  const values = { ...(draft?.values ?? valuesFromProfile(session.profile, session.email)) };
  if (session.email) values.email = session.email;
  // El nombre que da ChatGPT o Google rellena el alta (requisito F1 de la revisión).
  if (!values.firstName && !values.lastName && session.identityName) Object.assign(values, splitName(session.identityName));
  const chatgptChoice = draft?.chatgptChoice ?? '';
  const step = session.onboardingStage === 'profile' ? STEP_INDEX[session.onboarding?.step === 'pending' ? 'done' : session.onboarding?.step ?? 'terms'] : resumeStep({
    values,
    provider: session.provider,
    consents: session.consents,
    chatgptConnected: session.chatgptPlan.status === 'connected',
    chatgptChoice,
    // Sin borrador, el primer paso pendiente.
    savedStep: draft ? draft.step : PROFILE_STEP_COUNT - 1,
  });
  const accepted = (id: 'terms' | 'privacy' | 'ai-third-party') => !!currentConsent(session.consents, id);
  patchProfile({
    step,
    values,
    emailLocked: !!session.email,
    saving: false,
    status: pendingStatus,
    terms: { terms: accepted('terms'), privacy: accepted('privacy'), 'ai-third-party': accepted('ai-third-party') },
    chatgptChoice,
    chatgptConsent: false,
  });
  pendingStatus = '';
  patchUi({ dialog: USE_MOCKS ? 'profile' : null });
  if (!USE_MOCKS && navigation.pathname() !== '/espacio') navigation.go('/espacio', { replace: true });
  requestFocus(stepFocus(step));
}

/** Pasos sin llamada al servidor (Tú, Tu trabajo y Elige tu plan). */
export function profileNextStep(): void {
  const { step } = getUi().profile;
  if (step >= PROFILE_STEP_COUNT - 1) return;
  const order = onboardingOrder(currentSession().provider);
  goToStep(order[order.indexOf(step) + 1] ?? step);
}

export function profileBack(): void {
  const { step, saving } = getUi().profile;
  const order = onboardingOrder(currentSession().provider);
  const position = order.indexOf(step);
  if (position <= 0 || saving) return;
  goToStep(order[position - 1]);
}

/** Paso «Condiciones»: guarda cada aceptación con su versión y su fecha. */
export async function submitTerms(): Promise<void> {
  const state = getUi().profile;
  if (state.saving) return;
  if (!state.terms.terms || !state.terms.privacy || !state.terms['ai-third-party']) {
    patchProfile({ status: 'Marca las tres casillas para continuar.' });
    return;
  }
  const session = currentSession();
  const missing = missingConsents(session.consents);
  patchProfile({ saving: true, status: '' });
  try {
    if (missing.length) {
      const consents = await acceptConsents(missing.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })));
      if (missingConsents(consents).length) throw new Error('consents-not-saved');
      setSessionConsents(consents);
    }
  } catch {
    patchProfile({ saving: false, status: 'No se pudieron guardar tus aceptaciones. Inténtalo de nuevo.' });
    return;
  }
  if (session.provider === 'chatgpt' && session.chatgptPlan.status !== 'connected') {
    if (state.chatgptConsent) {
      patchProfile({ chatgptChoice: 'connect' });
      saveDraft(STEP_INDEX.terms);
      try {
        const result = await connectChatGPTPlan();
        if (result.kind === 'redirected') return;
      } catch {
        patchProfile({ saving: false, status: 'No se pudo autorizar el uso de tu plan de ChatGPT. Inténtalo de nuevo o desmarca el permiso para continuar sin él.' });
        return;
      }
    } else {
      patchProfile({ chatgptChoice: 'skip' });
    }
  }
  goToStep(STEP_INDEX.you);
}

/**
 * Paso «Conecta tu plan de ChatGPT»: permiso aparte y versionado. En modo real,
 * el backend devuelve la pantalla de permiso de OpenAI y la vuelta retoma el alta.
 */
export async function submitChatGPTStep(): Promise<void> {
  const state = getUi().profile;
  if (state.saving) return;
  if (currentSession().chatgptPlan.status === 'connected' || state.chatgptChoice === 'skip') {
    goToStep(STEP_INDEX.plan);
    return;
  }
  if (state.chatgptChoice !== 'connect') {
    patchProfile({ status: 'Elige si quieres conectar tu plan de ChatGPT.' });
    return;
  }
  if (!state.chatgptConsent) {
    patchProfile({ status: 'Marca la casilla para conceder el permiso.' });
    return;
  }
  patchProfile({ saving: true, status: '' });
  saveDraft(STEP_INDEX.chatgpt);
  try {
    const result = await connectChatGPTPlan();
    if (result.kind === 'connected') goToStep(STEP_INDEX.plan);
  } catch {
    patchProfile({ saving: false, status: 'No se pudo conectar tu plan de ChatGPT. Inténtalo de nuevo o sigue sin conectarlo.' });
  }
}

const isConsentsRequired = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && (error.data as { error?: unknown } | null)?.error === 'consents_required';

/**
 * «Entrar en mi espacio»: guarda el perfil y abre el espacio. Si el plan es de
 * pago, la guarda de facturación exige completarlo antes de montar el espacio.
 */
export async function submitProfile(): Promise<void> {
  const state = getUi().profile;
  if (state.saving) return;
  const checked = checkProfile(profileFromValues(state.values));
  if (!checked.ok) {
    goToStep(0, 'Revisa tus datos para continuar.');
    return;
  }
  patchProfile({ saving: true, status: '' });
  try {
    const result = await saveProfile(checked.profile);
    if (result?.profileComplete !== true || result.ageConfirmedAdult !== true) throw new Error('profile-not-confirmed');
    const profile = result.profile ? { ...checked.profile, ...result.profile } : checked.profile;
    markProfileReady(profile);
    clearDraft();
    patchUi({ dialog: null });
    patchProfile({ saving: false });
    await transitionToWorkspace();
  } catch (error) {
    if (isConsentsRequired(error)) {
      goToStep(STEP_INDEX.terms, 'Acepta las condiciones para crear tu espacio.');
      return;
    }
    patchProfile({ saving: false, status: 'No se pudo guardar tu perfil. Inténtalo de nuevo.' });
  }
}

/** X o Escape del alta: se guarda dónde se quedó; en el espacio se vuelve al inicio (prototipo). */
export function dismissProfile(): void {
  const { saving, step } = getUi().profile;
  if (saving) return;
  saveDraft(step);
  if (navigation.onWorkspace()) {
    // Primero se sale del espacio: su guarda no debe volver a abrir el alta.
    navigation.go(HOME_PATH);
    patchUi({ dialog: null });
    restoreFocus();
    return;
  }
  patchUi({ dialog: null });
  restoreFocus();
}

/** Solo pruebas. */
export function resetProfileFlow(): void {
  pendingStatus = '';
}
