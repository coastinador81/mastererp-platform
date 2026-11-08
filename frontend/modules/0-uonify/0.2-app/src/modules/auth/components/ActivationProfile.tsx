import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { saveIntegratedStep } from '../flows/integratedProfile';
import { STEP_INDEX } from '../model/options';
import { getUi, patchProfile, useAuthUi } from '../state/authUi';
import { ProfileStepAccount } from './ProfileStepAccount';
import { ProfileStepTerms } from './ProfileStepTerms';
import { ProfileStepWork } from './ProfileStepWork';
import { useCompactActivation } from '../hooks/useCompactActivation';
import type { ActivationStepProgress } from '../model/activation';

export function ActivationProfile({ onSaved, onProgress }: { onSaved: () => Promise<unknown>; onProgress?: (progress: ActivationStepProgress) => void }) {
  const { step, saving, status, values } = useAuthUi(state => state.profile);
  const form = useRef<HTMLFormElement>(null);
  const compact = useCompactActivation();
  const [page, setPage] = useState({ step: -1, index: 0 });
  const order = [STEP_INDEX.terms, STEP_INDEX.you, STEP_INDEX.work];
  const position = Math.max(0, order.indexOf(step));
  const current = order[position];
  const part = compact && page.step === current ? page.index : 0;
  useEffect(() => {
    const labels = compact ? ['Condiciones del servicio', 'Uso de la IA', 'Nombre y apellidos', 'Edad', 'Actividad y equipo', 'Tu objetivo'] : ['Condiciones de Uonify', 'Tus datos', 'Tu trabajo'];
    const index = compact ? position * 2 + part : position;
    onProgress?.({ id: `profile-${index}`, label: labels[index], index: index + 1, total: labels.length });
  }, [compact, position, part, onProgress]);
  const changePart = (index: number) => {
    setPage({ step: current, index });
    requestAnimationFrame(() => form.current?.querySelector(`[data-onboard-step="${current}"]`)?.querySelector<HTMLElement>('input,select')?.focus());
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const section = form.current?.querySelector(`[data-onboard-step="${current}"]`);
    for (const input of section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select') ?? []) if (!input.reportValidity()) return;
    if (compact && part === 0) { changePart(part + 1); return; }
    try {
      await saveIntegratedStep();
      if (!getUi().profile.status) await onSaved();
    } catch (failure) { patchProfile({ status: errorMessage(failure) }); }
  };
  return <form ref={form} className="activation-profile-form" data-activation-profile-part={compact && current === STEP_INDEX.terms && part === 1 ? 'ai-terms' : undefined} onSubmit={event => void submit(event)} noValidate>
    <fieldset className="uon-integrated-fields" disabled={saving}>
      <ProfileStepTerms hidden={current !== STEP_INDEX.terms} part={compact ? part === 0 ? 'general' : 'ai' : undefined} />
      <ProfileStepAccount hidden={current !== STEP_INDEX.you} part={compact ? part === 0 ? 'identity' : 'age' : undefined} />
      <ProfileStepWork hidden={current !== STEP_INDEX.work} part={compact ? part === 0 ? 'activity' : 'goal' : undefined} />
    </fieldset>
    <div className="activation-actions">
      {(position > 0 || part > 0) && <button type="button" className="uon-onboard-back" disabled={saving} onClick={() => { if (part > 0) changePart(part - 1); else patchProfile({ step: order[position - 1], status: '' }); }}>Volver</button>}
      <button className="uon-profile-submit" disabled={saving || (current === STEP_INDEX.you && values.ageRange === 'under18' && (!compact || part === 1))}>
        {saving ? 'Guardando…' : compact && part === 0 ? 'Siguiente apartado' : current === STEP_INDEX.terms ? 'Aceptar y continuar' : current === STEP_INDEX.work ? 'Guardar mis datos' : 'Continuar'}
      </button>
    </div>
    {status && <p role="alert">{status}</p>}
  </form>;
}
