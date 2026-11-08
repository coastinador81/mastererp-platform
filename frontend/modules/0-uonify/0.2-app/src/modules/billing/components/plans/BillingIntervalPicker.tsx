import { useId } from 'react';
import type { BillingInterval } from '../../model/plans';

export function BillingIntervalPicker({ value, onChange }: { value: BillingInterval; onChange: (value: BillingInterval) => void }) {
  const name = useId();
  return <fieldset className="bil-interval">
    <legend>Forma de pago</legend>
    <div className="bil-interval-options">
      {(['monthly', 'annual'] as const).map(interval => <label key={interval}>
        <input type="radio" name={name} value={interval} checked={value === interval} onChange={() => onChange(interval)} />
        <span>{interval === 'monthly' ? 'Mensual' : 'Anual'}</span>
      </label>)}
    </div>
    <p>{value === 'monthly' ? 'Paga mes a mes. Cancela la renovación cuando quieras.' : 'Paga por adelantado y disfruta de los meses incluidos en tu plan.'}</p>
  </fieldset>;
}
