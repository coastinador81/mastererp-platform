import { Icon } from '@/shared/ui';
import type { PaymentMethod } from '../../model/types';
import '../icons';

const BRANDS: Record<PaymentMethod['brand'], string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' };

/** «Visa ···· 4242». */
export function cardName(card: Pick<PaymentMethod, 'brand' | 'last4'>): string {
  return `${BRANDS[card.brand]} ···· ${card.last4}`;
}

/** «08/28». */
export function cardExpiry(card: Pick<PaymentMethod, 'expMonth' | 'expYear'>): string {
  return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
}

/** Tarjeta como la enseña Stripe: marca, últimos 4 dígitos y caducidad. */
export function CardLabel({ card }: { card: PaymentMethod }) {
  return (
    <span className="bil-card-label">
      <span className="bil-card-icon" aria-hidden="true">
        <Icon name="bil-card" size={16} />
      </span>
      <span className="bil-card-text">
        <strong>
          <span aria-hidden="true">{cardName(card)}</span>
          <span className="pim-sr-only">{`${BRANDS[card.brand]} acabada en ${card.last4}`}</span>
        </strong>
        <small>Caduca {cardExpiry(card)}</small>
      </span>
    </span>
  );
}
