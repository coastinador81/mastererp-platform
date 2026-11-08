import { IntegratedProfileDialog } from './IntegratedProfileDialog';
import { USE_MOCKS } from '@/shared/api/config';
import { IdentityReadyDialog } from './IdentityReadyDialog';
import { isPaidPlan } from '../model/plans';
import { useRef, type FormEvent } from 'react';
import clsx from 'clsx';
import { dismissProfile, profileBack, profileNextStep, submitChatGPTStep, submitProfile, submitTerms } from '../flows/profile';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { useAuthSession } from '../hooks/useSession';
import { ONBOARDING_STEPS, STEP_INDEX, type OnboardingStepId } from '../model/options';
import { onboardingOrder } from '../model/onboarding';
import { isAdultAgeRange } from '../model/profile';
import { requestFocus, useAuthUi } from '../state/authUi';
import { BRAND } from './brand';
import { ProfileStepAccount } from './ProfileStepAccount';
import { ProfileStepChatGPT } from './ProfileStepChatGPT';
import { ProfileStepDone } from './ProfileStepDone';
import { ProfileStepPlan } from './ProfileStepPlan';
import { ProfileStepTerms } from './ProfileStepTerms';
import { ProfileStepWork } from './ProfileStepWork';

// Título y entradilla de cada paso: nombran y describen el diálogo (prototipo: renderProfileStep).
const STEP_IDS: Record<OnboardingStepId, { title: string; intro: string }> = {
  you: { title: 'uon-profile-title', intro: 'uon-profile-intro' },
  work: { title: 'uon-profile-work-title', intro: 'uon-profile-work-intro' },
  terms: { title: 'uon-profile-terms-title', intro: 'uon-profile-terms-intro' },
  chatgpt: { title: 'uon-profile-chatgpt-title', intro: 'uon-profile-chatgpt-intro' },
  plan: { title: 'uon-profile-plan-title', intro: 'uon-profile-plan-intro' },
  done: { title: 'uon-profile-done-title', intro: 'uon-profile-done-intro' },
};

/** Alta por proveedor: condiciones primero; ChatGPT autoriza su plan en ese mismo paso. */
export function ProfileDialog() {
  const session = useAuthSession();
  if (!USE_MOCKS) return null;
  if (session.onboardingStage === 'profile') return <IntegratedProfileDialog />;
  return session.onboardingStage === 'identity' ? <IdentityReadyDialog /> : <FullProfileDialog />;
}

function FullProfileDialog() {
  const open = useAuthUi(state => state.dialog === 'profile');
  const { step, values, saving, status, chatgptChoice } = useAuthUi(state => state.profile);
  const session = useAuthSession();
  const chatgptConnected = session.chatgptPlan.status === 'connected';
  const order = onboardingOrder(session.provider);
  const position = order.indexOf(step);
  const { ref, onKeyDown } = useNativeDialog(open, dismissProfile);
  const form = useRef<HTMLFormElement>(null);
  const stepId = ONBOARDING_STEPS[step]?.id ?? 'you';
  const ageBlocked = stepId === 'you' && values.ageRange === 'under18';

  // Valida solo los campos del paso visible, con los mensajes del navegador.
  const validateStep = (): boolean => {
    const section = form.current?.querySelector(`[data-onboard-step="${step}"]`);
    for (const control of section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? []) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    if (stepId === 'you' && !isAdultAgeRange(values.ageRange)) {
      requestFocus('#uon-profile-age');
      return false;
    }
    return true;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !validateStep()) return;
    if (stepId === 'terms') void submitTerms();
    else if (stepId === 'chatgpt') void submitChatGPTStep();
    else if (stepId === 'done') void submitProfile();
    else profileNextStep();
  };

  const submitLabel =
    stepId === 'done'
      ? isPaidPlan(values.plan) ? 'Continuar al pago' : 'Entrar en mi espacio'
      : stepId === 'terms'
        ? 'Aceptar y continuar'
        : stepId === 'chatgpt' && !chatgptConnected && chatgptChoice === 'connect'
          ? 'Conectar y continuar'
          : 'Continuar';

  return (
    <dialog
      ref={ref}
      id="uon-profile-dialog"
      className="uon-profile-dialog"
      aria-labelledby={STEP_IDS[stepId].title}
      aria-describedby={STEP_IDS[stepId].intro}
      data-step={stepId}
      onKeyDown={onKeyDown}
    >
      <div className="uon-onboard-shell">
        <aside className="uon-onboard-side">
          <img data-uonify-logo="relief" className="uon-profile-brand" src={BRAND.wordmark} width={142} height={30} alt="Uonify" />
          <div className="uon-onboard-side-copy">
            <span>Un espacio que se adapta a ti.</span>
            <p>Conecta tus herramientas, organiza tu trabajo y decide cómo quieres avanzar.</p>
          </div>
        </aside>
        <div className="uon-onboard-main">
          <button
            className="uon-auth-close"
            type="button"
            data-onboard-dismiss
            aria-label="Cerrar el alta"
            disabled={saving}
            onClick={dismissProfile}
          >
            ×
          </button>
          <ol className="uon-onboard-progress" aria-label="Progreso del alta">
            {order.map((stepIndex, index) => { const item = ONBOARDING_STEPS[stepIndex]; return (
              <li
                key={item.id}
                className={clsx(index === position && 'is-current', index < position && 'is-complete')}
                aria-current={index === position ? 'step' : undefined}
              >
                <span className="pim-sr-only">{item.name}</span>
              </li>
            ); })}
          </ol>
          <p className="uon-auth-overline" id="uon-onboard-step-label">
            {`PASO ${position + 1} DE ${order.length} · ${ONBOARDING_STEPS[step].label}`}
          </p>
          {open ? (
            <form id="uon-profile-form" ref={form} noValidate onSubmit={onSubmit}>
              <ProfileStepAccount hidden={step !== STEP_INDEX.you} />
              <ProfileStepWork hidden={step !== STEP_INDEX.work} />
              <ProfileStepTerms hidden={step !== STEP_INDEX.terms} />
              {session.provider !== 'chatgpt' ? <ProfileStepChatGPT hidden={step !== STEP_INDEX.chatgpt} /> : null}
              <ProfileStepPlan hidden={step !== STEP_INDEX.plan} />
              <ProfileStepDone hidden={step !== STEP_INDEX.done} />
              <div className="uon-onboard-actions">
                <button className="uon-onboard-back" type="button" data-onboard-back hidden={position === 0} disabled={saving} onClick={profileBack}>
                  Volver
                </button>
                <button
                  className="uon-profile-submit"
                  type="submit"
                  data-onboard-next
                  data-age-blocked={ageBlocked ? 'true' : 'false'}
                  disabled={saving || ageBlocked}
                  aria-busy={saving || undefined}
                >
                  {/* Un solo elemento flexible, como el texto «Continuar →» del prototipo. */}
                  <span>
                    {submitLabel} <span aria-hidden="true">→</span>
                  </span>
                </button>
              </div>
              <p className="uon-profile-status" id="uon-profile-status" role="status" hidden={!status}>
                {status}
              </p>
            </form>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
