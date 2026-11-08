import { useId, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Alert, Spinner } from '@/shared/ui';
import type { PaymentDetails, PaymentMethod } from '../../model/types';
import { CardLabel } from '../common/CardLabel';
import { StripeCardMock, type CardEntry } from './StripeCardMock';

export interface PaymentChoiceHandle { read: () => PaymentDetails | null }

export interface PaymentChoiceProps {
  ref?: Ref<PaymentChoiceHandle>;
  error?: boolean;
  card: PaymentMethod | null | undefined;
  loading?: boolean;
  useNewCard: boolean;
  onUseNewCardChange: (useNew: boolean) => void;
  disabled?: boolean;
}

export function PaymentChoice({ ref, card, loading = false, error = false, useNewCard, onUseNewCardChange, disabled = false }: PaymentChoiceProps) {
  const name = useId();
  const entry = useRef<CardEntry>(null);
  const [saveCard, setSaveCard] = useState(false);
  useImperativeHandle(ref, () => ({ read: () => {
    if (loading || error || disabled) return null;
    if (card && !useNewCard) return { paymentMethod: card.id };
    const newCard = entry.current?.read();
    return newCard ? { paymentMethod: 'new', newCard, savePaymentMethod: saveCard } : null;
  } }));
  return (
    <fieldset className="bil-pay" disabled={disabled}>
      <legend className="bil-block-title">Método de pago</legend>
      {error ? <Alert tone="red">No se ha podido cargar tu método de pago. Cierra esta ventana y vuelve a intentarlo.</Alert> : loading ? (
        <Spinner label="Cargando tu método de pago…" />
      ) : (
        <>
          {card ? (
            <div className="bil-pay-options">
              <label className="bil-pay-option">
                <input type="radio" className="pim-check" name={name} checked={!useNewCard} onChange={() => onUseNewCardChange(false)} />
                <CardLabel card={card} />
              </label>
              <label className="bil-pay-option">
                <input type="radio" className="pim-check" name={name} checked={useNewCard} onChange={() => onUseNewCardChange(true)} />
                <span>Otra tarjeta</span>
              </label>
            </div>
          ) : null}
          {!card || useNewCard ? <>
            <StripeCardMock ref={entry} disabled={disabled} />
            <label className="bil-pay-option">
              <input type="checkbox" className="pim-check" checked={saveCard} onChange={event => setSaveCard(event.target.checked)} />
              <span>Guardar esta tarjeta para próximos pagos <small>(opcional)</small></span>
            </label>
            <p className="bil-fine">Puedes pagar sin guardarla. Si no la guardas, tendrás que introducirla de nuevo para otras compras.</p>
          </> : null}
        </>
      )}
    </fieldset>
  );
}
