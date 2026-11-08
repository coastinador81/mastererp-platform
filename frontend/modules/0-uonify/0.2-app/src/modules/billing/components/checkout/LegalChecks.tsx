import { useId, type RefObject } from 'react';
import { ErrorText } from '@/shared/ui';
import { longDate } from '../../model/money';
import { WITHDRAWAL_DAYS } from '../../model/refund';

export interface LegalAcceptance {
  terms: boolean;
  withdrawal: boolean;
}

export interface LegalChecksProps {
  value: LegalAcceptance;
  onChange: (value: LegalAcceptance) => void;
  /** Último día para desistir si se paga hoy. */
  withdrawalUntil: string;
  /** Se intentó pagar sin marcar las casillas. */
  showError: boolean;
  termsRef?: RefObject<HTMLInputElement | null>;
  withdrawalRef?: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

/**
 * Casillas legales del pago anual: Condiciones y privacidad, e inicio inmediato del
 * servicio con la información del desistimiento de 14 días (devolución menos los
 * tokens de Uonify del plan gastados, a precio de tarifa).
 */
export function LegalChecks({ value, onChange, withdrawalUntil, showError, termsRef, withdrawalRef, disabled = false }: LegalChecksProps) {
  const id = useId();
  const missing = showError && (!value.terms || !value.withdrawal);
  const errorId = `${id}-error`;
  return (
    <fieldset className="bil-legal" disabled={disabled} aria-describedby={missing ? errorId : undefined}>
      <legend className="pim-sr-only">Condiciones del pago</legend>
      <label className="bil-legal-check">
        <input
          ref={termsRef}
          type="checkbox"
          className="pim-check"
          checked={value.terms}
          aria-invalid={(missing && !value.terms) || undefined}
          onChange={event => onChange({ ...value, terms: event.target.checked })}
        />
        <span>
          He leído y acepto las{' '}
          <a href="/terminos" target="_blank" rel="noopener">
            Condiciones del servicio
          </a>{' '}
          y la{' '}
          <a href="/privacidad" target="_blank" rel="noopener">
            Política de privacidad
          </a>
          .
        </span>
      </label>
      <label className="bil-legal-check">
        <input
          ref={withdrawalRef}
          type="checkbox"
          className="pim-check"
          checked={value.withdrawal}
          aria-invalid={(missing && !value.withdrawal) || undefined}
          onChange={event => onChange({ ...value, withdrawal: event.target.checked })}
        />
        <span>
          Quiero que el plan empiece hoy. Sé que puedo desistir en {WITHDRAWAL_DAYS} días naturales, hasta el {longDate(withdrawalUntil)}, y
          que entonces me devolveréis lo pagado menos los tokens de Uonify del plan que haya gastado, a precio de tarifa, con una nota de
          crédito y una factura rectificativa.
        </span>
      </label>
      {missing ? <ErrorText id={errorId}>Marca las dos casillas para continuar.</ErrorText> : null}
    </fieldset>
  );
}
