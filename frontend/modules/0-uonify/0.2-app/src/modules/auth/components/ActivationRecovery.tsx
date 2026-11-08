import { useRef, useState } from 'react';
import { InformationDisclosure } from '@/shared/ui';
import type { SetupOperation } from '../model/activation';

interface Props {
  operation: SetupOperation;
  busy: boolean;
  checking?: boolean;
  hideMessage?: boolean;
  pendingRequest?: boolean;
  compact?: boolean;
  consentStep?: boolean;
  onConsentStep?: (value: boolean) => void;
  onOpen: () => void;
  onResume: () => void;
  onRetryModel: () => void;
  onDiagnose?: () => void;
}

/** Una prueba incierta conserva su historial y exige una autorización nueva, separada. */
export function ActivationRecovery({ operation, busy, checking = false, hideMessage = false, pendingRequest = false, compact = false, consentStep = false, onConsentStep, onOpen, onResume, onRetryModel, onDiagnose }: Props) {
  const [additionalCost, setAdditionalCost] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const recovery = operation.recovery;
  if (!recovery) return null;
  const unknown = operation.status === 'unknown' || operation.modelTest === 'unknown';
  const modelRetry = recovery.kind !== 'authorization' && operation.canRetryModel === true && (unknown || operation.modelTest === 'failed');
  const diagnose = recovery.kind !== 'authorization' && operation.canDiagnose && !modelRetry && onDiagnose;
  const showConsent = !compact || consentStep;
  return <section className="activation-recovery" aria-label="Continuar la preparación de Google">
    {!hideMessage && <p>{recovery.message}</p>}
    {!diagnose && (!modelRetry || !compact || !consentStep) && (recovery.url || recovery.kind === 'authorization') && <button type="button" className="uon-onboard-back" disabled={busy} onClick={onOpen}>{recovery.label}</button>}
    {diagnose ? <button type="button" className="uon-profile-submit" disabled={busy} onClick={onDiagnose}>{checking ? 'Revisando conexión…' : 'Revisar conexión con Uony'}</button> : modelRetry ? <>
      {compact && !consentStep && <div className="cld-actions"><button type="button" className="uon-profile-submit" disabled={busy} onClick={() => { onConsentStep?.(true); requestAnimationFrame(() => checkbox.current?.focus()); }}>{operation.accessCheck?.status === 'eligible' ? 'Continuar a la prueba de respuesta' : 'Ya lo he revisado, autorizar otra prueba'}</button></div>}
      <div hidden={!showConsent}>
        {compact && <InformationDisclosure label="Revisar el problema anterior"><p>{recovery.message}</p><button type="button" className="uon-onboard-back" disabled={busy || pendingRequest} onClick={() => onConsentStep?.(false)}>Volver al resultado</button></InformationDisclosure>}
        <label className="activation-consent"><input ref={checkbox} type="checkbox" checked={additionalCost} disabled={busy || pendingRequest || !operation.canRetryModel} onChange={event => setAdditionalCost(event.target.checked)} />Autorizo una nueva prueba de IA con Google. {unknown && 'La anterior podría haberse procesado. '}Entiendo que volver a probar puede generar consumo adicional.</label>
        <button type="button" className="uon-profile-submit" disabled={busy || !additionalCost || !operation.canRetryModel} onClick={onRetryModel}>{checking ? 'Comprobando…' : pendingRequest ? 'Consultar la solicitud pendiente con Uony' : 'Autorizar nueva prueba con Uony'}</button>
      </div>
    </> : <>
      {recovery.kind !== 'billing' && recovery.kind !== 'authorization' && <button type="button" className="uon-profile-submit" disabled={busy || !operation.canResume} onClick={onResume}>Ya lo he revisado, continuar</button>}
    </>}
  </section>;
}
