import { useEffect, useRef, type FormEvent } from 'react';
import clsx from 'clsx';
import { OnboardingSubscription } from '@/modules/billing';
import { GoogleTools } from '@/modules/cloud';
import { signOut } from '../flows/account';
import { completeIntegratedOnboarding, saveIntegratedStep } from '../flows/integratedProfile';
import { dismissProfile, stepFocus } from '../flows/profile';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { useAuthSession } from '../hooks/useSession';
import { STEP_INDEX } from '../model/options';
import { patchProfile, requestFocus, useAuthUi } from '../state/authUi';
import { useSetupStage } from '../hooks/useSetupStage';
import '../styles/setup.css';
import { BRAND } from './brand';
import { ProfileStepAccount } from './ProfileStepAccount';
import { ProfileStepTerms } from './ProfileStepTerms';
import { ProfileStepWork } from './ProfileStepWork';

const steps = [
  { index: STEP_INDEX.terms, id: 'terms', label: 'Condiciones' },
  { index: STEP_INDEX.you, id: '', label: 'Tus datos' },
  { index: STEP_INDEX.work, id: 'work-', label: 'Tu trabajo' },
];

/** Flujo real disponible: condiciones y perfil; acceso al espacio aún no habilitado. */
export function IntegratedProfileDialog() {
  const open = useAuthUi(state => state.dialog === 'profile');
  const { step, saving, status, values } = useAuthUi(state => state.profile);
  const session = useAuthSession();
  const form = useRef<HTMLFormElement>(null);
  const { ref, onKeyDown } = useNativeDialog(open, dismissProfile);
  const position = steps.findIndex(item => item.index === step);
  const pending = position < 0;
  const setup = useSetupStage(session.email, open && pending);
  useEffect(() => {
    if (open && pending) { ref.current?.scrollTo?.(0, 0); document.getElementById('uon-profile-pending-title')?.focus(); }
  }, [open, pending, setup.google, ref]);
  const title = pending ? 'uon-profile-pending-title' : step === STEP_INDEX.terms ? 'uon-profile-terms-title' : `uon-profile-${steps[position].id}title`;
  const back = () => {
    const next = pending ? STEP_INDEX.work : steps[Math.max(0, position - 1)].index;
    patchProfile({ step: next, status: '' });
    requestFocus(stepFocus(next));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving || pending) return;
    const section = form.current?.querySelector(`[data-onboard-step="${step}"]`);
    for (const control of section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select') ?? []) {
      if (!control.reportValidity()) return;
    }
    void saveIntegratedStep();
  };
  const logout = async () => {
    patchProfile({ saving: true });
    try { await signOut(); } finally { patchProfile({ saving: false }); }
  };
  return (
    <dialog ref={ref} className={clsx("uon-profile-dialog", pending && "uon-setup-dialog")} aria-labelledby={title} onKeyDown={onKeyDown}>
      <div className="uon-onboard-shell">
        <aside className="uon-onboard-side">
          <img className="uon-profile-brand" src={BRAND.wordmark} width={142} height={30} alt="Uonify" />
          <div className="uon-onboard-side-copy"><span>{pending ? setup.google ? <>Conecta.<br />Crea.<br /><em>Hazlo posible.</em></> : <>Tu próximo<br />paso empieza<br />aquí.</> : 'Tu trabajo empieza contigo.'}</span><p>{pending ? setup.google ? 'Tus herramientas, en un solo lugar. Te acompañamos en cada paso.' : 'Activa tu acceso a Uonify. Después conectaremos tus herramientas.' : 'Completa tus datos. Guardamos cada paso para que puedas retomarlo cuando quieras.'}</p></div>
        </aside>
        <div className="uon-onboard-main">
          <button className="uon-auth-close" type="button" aria-label="Cerrar el alta" disabled={saving} onClick={dismissProfile}>×</button>
          {pending ? <ol className="uon-setup-progress" aria-label="Progreso del alta"><li className="is-complete">✓ <span>Perfil</span></li><li className={setup.google ? 'is-complete' : 'is-current'} aria-current={!setup.google ? 'step' : undefined}>{setup.google ? '✓' : '2'} <span>Suscripción</span></li><li className={setup.google ? 'is-current' : ''} aria-current={setup.google ? 'step' : undefined}>3 <span>Google</span></li></ol> : <ol className="uon-onboard-progress" aria-label="Progreso de tus datos">
            {steps.map((item, index) => <li key={item.index} className={clsx(index === position && 'is-current', (pending || index < position) && 'is-complete')} aria-current={index === position ? 'step' : undefined}><span className="pim-sr-only">{item.label}</span></li>)}
          </ol>}
          <p className="uon-auth-overline">{pending ? setup.google ? 'TUS HERRAMIENTAS · PASO 3 DE 3' : 'TU ACCESO · PASO 2 DE 3' : `TUS DATOS · ${position + 1} DE 3 · ${steps[position].label.toUpperCase()}`}</p>
          {open && (pending ? <section>
            <h2 id="uon-profile-pending-title" tabIndex={-1}>{setup.google ? 'Conecta tus herramientas' : 'Tu suscripción'}</h2>
            {setup.access.isPending ? <p role="status">Recuperando tu progreso…</p> : setup.access.isError ? <p role="status">No podemos comprobar tu acceso. <button className="uon-onboard-back" onClick={() => void setup.access.refetch()}>Reintentar</button></p> : setup.google ? <GoogleTools account={session.email} onContinue={completeIntegratedOnboarding} /> : <OnboardingSubscription account={session.email} onContinue={setup.next} />}
            <div className="uon-onboard-actions uon-setup-footer">
              <button className="uon-onboard-back" type="button" onClick={setup.google ? setup.review : back}>{setup.google ? '← Suscripción' : 'Revisar mis datos'}</button>
              <button className="uon-onboard-back" type="button" onClick={dismissProfile}>Guardar y salir</button>
            </div>
            <button className="uon-onboard-back" type="button" disabled={saving} onClick={() => void logout()}>{saving ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
          </section> : <form ref={form} noValidate onSubmit={submit}>
            <fieldset className="uon-integrated-fields" disabled={saving}>
              <ProfileStepTerms hidden={step !== STEP_INDEX.terms} />
              <ProfileStepAccount hidden={step !== STEP_INDEX.you} />
              <ProfileStepWork hidden={step !== STEP_INDEX.work} />
            </fieldset>
            <div className="uon-onboard-actions">
              <button className="uon-onboard-back" type="button" hidden={position === 0} disabled={saving} onClick={back}>Volver</button>
              <button className="uon-profile-submit" type="submit" disabled={saving || (step === STEP_INDEX.you && values.ageRange === 'under18')} aria-busy={saving || undefined}>
                {saving ? 'Guardando…' : step === STEP_INDEX.terms ? 'Aceptar y continuar' : step === STEP_INDEX.work ? 'Guardar mis datos' : 'Continuar'}
              </button>
            </div>
            <p className="uon-profile-status" role="status" hidden={!status}>{status}</p>
          </form>)}
        </div>
      </div>
    </dialog>
  );
}
