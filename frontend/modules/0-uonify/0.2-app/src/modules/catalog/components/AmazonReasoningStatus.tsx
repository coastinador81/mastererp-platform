import { useState } from 'react';
import { Icon } from '@/shared/ui';
import { customerText } from '@/shared/lib/customerText';
import type { AmazonReasoning } from '../api/amazonRequirements';
import '../styles/reasoning.css';

interface Props { reasoning: AmazonReasoning; disabled?: boolean; onRetry: (acknowledgeUnknown: boolean) => void }

/** Los reintentos que podrían consumir otra ejecución requieren una decisión expresa. */
export function AmazonReasoningStatus({ reasoning, disabled = false, onRetry }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const waiting = ['queued', 'running'].includes(reasoning.status);
  const unknown = reasoning.status === 'unknown' || reasoning.requiresConsumptionAcknowledgement === true;
  return <div className="amazon-reasoning" aria-busy={waiting}>
    <div className="amazon-reasoning-heading"><Icon name="uony" size={22} /><strong>{waiting
      ? 'Uony está revisando tus documentos e imágenes' : reasoning.requiresPreparation ? 'Tus documentos están listos para revisar' : reasoning.status === 'stale'
        ? 'Tus datos han cambiado' : 'La revisión necesita tu atención'}</strong></div>
    <p role={waiting ? 'status' : 'alert'}>{customerText(reasoning.message)}</p>
    {waiting ? <p>Te preguntaré solo lo que falte después de esta revisión. Puedes seguir usando tu conversación.</p> : reasoning.canRetry !== false && <>
      {unknown && <label className="amazon-reasoning-consent"><input type="checkbox" checked={acknowledged} disabled={disabled}
        onChange={event => setAcknowledged(event.target.checked)} />
        <span>Hay un intento cuyo consumo no hemos podido confirmar. Entiendo que realizar otra revisión puede generar consumo adicional de IA.</span></label>}
      <button type="button" disabled={disabled || (unknown && !acknowledged)} onClick={() => onRetry(unknown && acknowledged)}>
        <Icon name="uony" size={18} />{reasoning.requiresPreparation ? 'Revisar documentos con Uony' : reasoning.status === 'stale' ? 'Actualizar revisión con Uony' : 'Reintentar con Uony'}
      </button>
    </>}
  </div>;
}
