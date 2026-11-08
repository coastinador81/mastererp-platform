import { api, errorMessage } from '@/shared/api/client';
import { prepareOnboardingEntry } from '@/modules/workspace';
import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import { STEP_INDEX } from '../model/options';
import { parseSession } from '../model/session';
import type { SessionPayload } from '../model/types';
import { getUi, patchProfile, patchUi, requestFocus, setSurface } from '../state/authUi';
import { currentAccountEmail, currentSession, setSession } from '../state/session';
import { navigation } from './navigation';
import { stepFocus } from './profile';

/** Cada avance depende de la confirmación del servidor; nunca activa una suscripción. */
export async function saveIntegratedStep(): Promise<void> {
  const { step, values, terms, saving } = getUi().profile;
  if (saving) return;
  const session = currentSession();
  const kind = step === STEP_INDEX.terms ? 'terms' : step === STEP_INDEX.you ? 'you' : 'work';
  if (kind === 'terms' && (!terms.terms || !terms.privacy || !terms['ai-third-party'])) {
    patchProfile({ status: 'Marca las tres casillas para continuar.' });
    return;
  }
  const body = kind === 'terms' ? { consents: TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })) }
    : kind === 'you' ? { firstName: values.firstName, lastName: values.lastName, ageRange: values.ageRange }
      : { role: values.role, companySize: values.companySize, company: values.company, primaryGoal: values.primaryGoal, source: values.source };
  patchProfile({ saving: true, status: '' });
  try {
    const saved = await api.post<Pick<SessionPayload, 'profile' | 'profileComplete' | 'ageConfirmedAdult' | 'onboarding' | 'onboardingStage' | 'consents'>>(`/onboarding/${kind}`, body, { signal: AbortSignal.timeout(10_000) });
    if (session.email !== currentAccountEmail()) return;
    if (!saved.onboarding || saved.onboardingStage !== 'profile') throw new Error('No se ha confirmado el guardado. Inténtalo de nuevo.');
    setSession(parseSession({ authenticated: true, email: session.email, account: { provider: session.provider }, identity: { name: session.identityName }, ...saved }));
    // Al editar un paso anterior se puede revisar el siguiente antes del resumen.
    const next = kind === 'terms' ? STEP_INDEX.you : kind === 'you' ? STEP_INDEX.work : STEP_INDEX.done;
    patchProfile({ step: next, saving: false });
    requestFocus(next === STEP_INDEX.done ? '#uon-profile-pending-title' : stepFocus(next));
  } catch (error) {
    if (session.email === currentAccountEmail()) patchProfile({ saving: false, status: errorMessage(error, 'No se han podido guardar tus datos. Inténtalo de nuevo.') });
  }
}

/** El backend confirma el alta; las conexiones opcionales nunca bloquean el cierre. */
export async function completeIntegratedOnboarding(): Promise<void> {
  const session = currentSession();
  const saved = await api.post<Partial<SessionPayload>>('/onboarding/complete', {}, { signal: AbortSignal.timeout(10_000) });
  if (session.email !== currentAccountEmail()) throw new Error('Tu sesión ha cambiado.');
  if (!saved.profileComplete) throw new Error('No se ha confirmado el final del alta. Inténtalo de nuevo.');
  setSession(parseSession({ authenticated: true, email: session.email, account: { provider: session.provider }, identity: { name: session.identityName }, ...saved }));
  prepareOnboardingEntry(session.email!);
  patchUi({ dialog: null });
  setSurface(false);
  navigation.go('/espacio', { replace: true });
}
