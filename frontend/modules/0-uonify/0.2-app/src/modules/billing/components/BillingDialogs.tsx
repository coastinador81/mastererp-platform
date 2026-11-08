import { useBillingDialogs } from '../flows/dialogs';
import { CheckoutDialog } from './checkout/CheckoutDialog';
import { PaymentMethodDialog } from './checkout/PaymentMethodDialog';
import { PaywallDialog } from './paywall/PaywallDialog';
import { RechargeDialog } from './recharge/RechargeDialog';
import { SupportDialog } from './support/SupportDialog';
import { WithdrawalDialog } from './withdrawal/WithdrawalDialog';

/** Pinta el diálogo de facturación abierto (uno como mucho). */
export function BillingDialogs() {
  const current = useBillingDialogs(state => state.current);
  if (!current) return null;
  switch (current.kind) {
    case 'checkout':
      return <CheckoutDialog key={current.id} id={current.id} planId={current.planId} interval={current.interval ?? 'monthly'} />;
    case 'recharge':
      return <RechargeDialog key={current.id} id={current.id} />;
    case 'withdrawal':
      return <WithdrawalDialog key={current.id} id={current.id} />;
    case 'support':
      return <SupportDialog key={current.id} id={current.id} />;
    case 'payment-method':
      return <PaymentMethodDialog key={current.id} id={current.id} />;
    case 'paywall':
      return <PaywallDialog key={current.id} id={current.id} detail={current.detail} />;
    default:
      return null;
  }
}
