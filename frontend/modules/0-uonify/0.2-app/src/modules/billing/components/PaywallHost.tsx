import { useEffect } from 'react';
import { onPlanRequired } from '@/shared/api/planRequired';
import { exposeDevHelpers } from '../dev/paywall';
import { openBillingDialog, registerBillingHost, useBillingDialogs } from '../flows/dialogs';
import { samePaywall } from '../model/paywall';
import { BillingDialogs } from './BillingDialogs';

/**
 * Muro de pago y diálogos de facturación. Montado una vez en AppProviders (dentro
 * del proveedor de datos): escucha los 402 del backend (onPlanRequired) y abre el
 * aviso, y pinta el pago, la recarga, el desistimiento, la tarjeta y «Apoya a
 * Uonify» que abren startCheckout() y compañía. Si ya hay un pago en curso, un
 * 402 no lo interrumpe.
 */
export function PaywallHost() {
  useEffect(() => registerBillingHost(), []);
  useEffect(() => {
    exposeDevHelpers();
    return onPlanRequired(detail => {
      const current = useBillingDialogs.getState().current;
      if (current && current.kind !== 'paywall') return;
      if (current?.kind === 'paywall' && samePaywall(current.detail, detail)) return;
      void openBillingDialog({ kind: 'paywall', detail });
    });
  }, []);
  return <BillingDialogs />;
}
