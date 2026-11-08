import { ACTIVATION_STEPS, type ActivationStep, type ActivationStepProgress } from '../model/activation';

/** Las fases y el apartado actual comparten un único indicador comprensible. */
export function ActivationProgress({ step, current }: { step?: ActivationStep; current?: ActivationStepProgress }) {
  const complete = step === 'complete';
  const position = complete ? ACTIVATION_STEPS.length - 1 : Math.max(0, ACTIVATION_STEPS.findIndex(item => item.id === step));
  const percentage = complete ? 100 : Math.round((position + (current ? (current.index - 1) / current.total : 0)) / ACTIVATION_STEPS.length * 100);
  const label = complete ? 'Todo preparado' : current?.label ?? ACTIVATION_STEPS[position].label;
  return <nav className="activation-progress" id="activation-progress" tabIndex={-1} aria-label="Progreso de la preparación">
    <ol className="activation-progress-phases">{ACTIVATION_STEPS.map((item, index) => <li key={item.id} aria-current={!complete && step === item.id ? 'step' : undefined} className={complete || index < position ? 'is-complete' : index === position ? 'is-current' : ''}>
      <span className="activation-phase-marker" aria-hidden="true">{complete || index < position ? '✓' : index + 1}</span>
      <span>{item.label}</span>
    </li>)}</ol>
    <div className="activation-progress-track" role="progressbar" aria-label="Preparación de tu cuenta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={complete ? 'Todo preparado' : `Fase ${position + 1} de 4: ${ACTIVATION_STEPS[position].label}. ${label}${current && current.total > 1 ? `, ${current.index} de ${current.total}` : ''}`}>
      <span style={{ width: `${percentage}%` }} />
    </div>
    <div className="activation-progress-current" aria-live="polite"><strong>{label}</strong>{!complete && current && current.total > 1 && <span>{current.index} de {current.total}</span>}</div>
  </nav>;
}
