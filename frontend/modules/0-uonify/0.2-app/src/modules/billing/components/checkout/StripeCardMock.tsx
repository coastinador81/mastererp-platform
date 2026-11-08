import { formatCardField } from '../../model/cardInput';
import { useId, useImperativeHandle, useRef, type Ref } from 'react';
import { Icon } from '@/shared/ui';
import { uid } from '@/shared/lib';
import { cardExpiry, cardNumberValid } from '../../model/card';
import type { PaymentMethod } from '../../model/types';

export interface CardEntry { read: () => PaymentMethod | null }

/** Adaptador local. Sustituir por Stripe Elements antes de activar cobros reales.
 * Los datos sensibles viven solo en los campos; salen únicamente los metadatos.
 */
export function StripeCardMock({ ref, disabled = false }: { ref?: Ref<CardEntry>; disabled?: boolean }) {
  const id = useId();
  const number = useRef<HTMLInputElement>(null);
  const expiry = useRef<HTMLInputElement>(null);
  const cvc = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ read: () => {
    const digits = number.current!.value.replace(/\s/g, '');
    const date = cardExpiry(expiry.current!.value);
    const amex = /^3[47]/.test(digits);
    const checks: Array<[HTMLInputElement, boolean, string]> = [
      [number.current!, cardNumberValid(digits), 'Introduce los 16 dígitos de la tarjeta.'],
      [expiry.current!, !!date, 'Indica una caducidad válida en formato MM/AA.'],
      [cvc.current!, /^\d{3}$/.test(cvc.current!.value), 'Introduce los 3 dígitos del CVC.'],
    ];
    for (const [input, valid, message] of checks) {
      input.setCustomValidity(valid ? '' : message);
      if (!input.reportValidity()) return null;
    }
    return { id: uid('pm_card'), brand: amex ? 'amex' : digits.startsWith('4') ? 'visa' : 'mastercard', last4: digits.slice(-4), ...date! };
  } }));
  const formatInput = (event: React.FormEvent<HTMLInputElement>, kind: 'number' | 'expiry' | 'cvc') => {
    const input = event.currentTarget;
    const formatted = formatCardField(input.value, input.selectionStart ?? input.value.length, kind);
    input.value = formatted.value;
    input.setSelectionRange(formatted.caret, formatted.caret);
    input.setCustomValidity('');
  };
  return (
    <div className="bil-stripe" role="group" aria-labelledby={`${id}-title`}>
      <div className="bil-stripe-head"><span id={`${id}-title`} className="bil-stripe-title">Tarjeta</span></div>
      <label className="bil-stripe-field" htmlFor={`${id}-number`}>
        <span>Número de tarjeta</span>
        <input ref={number} id={`${id}-number`} className="pim-input pim-mono" placeholder="Número de tarjeta" inputMode="numeric" autoComplete="off" maxLength={19} required disabled={disabled} onInput={event => formatInput(event, 'number')} />
      </label>
      <div className="bil-stripe-row">
        <label className="bil-stripe-field" htmlFor={`${id}-exp`}>
          <span>Caducidad</span>
          <input ref={expiry} id={`${id}-exp`} className="pim-input pim-mono" placeholder="MM/AA" inputMode="numeric" autoComplete="off" maxLength={7} required disabled={disabled} onInput={event => formatInput(event, 'expiry')} />
        </label>
        <label className="bil-stripe-field" htmlFor={`${id}-cvc`}>
          <span>CVC</span>
          <input ref={cvc} id={`${id}-cvc`} className="pim-input pim-mono" type="password" placeholder="CVC" inputMode="numeric" autoComplete="off" maxLength={3} required disabled={disabled} onInput={event => formatInput(event, 'cvc')} />
        </label>
      </div>
      <p className="bil-stripe-note"><Icon name="shield" size={14} />No guardamos el número completo ni el CVC.</p>
    </div>
  );
}
