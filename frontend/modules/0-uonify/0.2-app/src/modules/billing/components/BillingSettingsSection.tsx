import { errorMessage } from '@/shared/api/client';
import { Alert, Head, LinkButton, Spinner } from '@/shared/ui';
import { useSubscription } from '../hooks/useBilling';
import { usePlans } from '../hooks/usePlans';
import { BalancePanel } from './settings/BalancePanel';
import { InvoicesPanel } from './settings/InvoicesPanel';
import { PaymentPanel } from './settings/PaymentPanel';
import { PlanOverview } from './settings/PlanOverview';
import { SupportPanel } from './settings/SupportPanel';

/**
 * Sección «Plan y facturación» de Configuración (/espacio/configuracion/plan):
 * plan actual y renovación, cambio de plan, desistimiento, tokens de Uonify con
 * recarga y movimientos, método de pago, facturas y «Apoya a Uonify».
 * Los diálogos los pinta <PaywallHost/> (AppProviders).
 */
export function BillingSettingsSection() {
  const subscription = useSubscription();
  const plans = usePlans();
  // Un botón sólido por vista: en Gratis, «Ver planes»; con plan, «Recargar».
  const free = (subscription.data?.planId ?? 'free') === 'free';
  return (
    <div className="bil-settings">
      <Head title="Plan y facturación" subtitle="Tu plan de Uonify, los tokens de Uonify, los pagos y las facturas." />
      {subscription.isPending || plans.isPending ? (
        <Spinner label="Cargando tu plan…" />
      ) : subscription.isError || plans.isError || !subscription.data || !plans.data ? (
        <Alert tone="red" role="alert" title="No se ha podido cargar tu plan">
          {errorMessage(subscription.error ?? plans.error)}{' '}
          <LinkButton
            onClick={() => {
              void subscription.refetch();
              void plans.refetch();
            }}
          >
            Reintentar
          </LinkButton>
        </Alert>
      ) : (
        <PlanOverview subscription={subscription.data} plans={plans.data} primary={free} />
      )}
      <BalancePanel primary={!free && !!subscription.data} />
      <PaymentPanel />
      <InvoicesPanel />
      {subscription.data ? <SupportPanel support={subscription.data.support} /> : null}
    </div>
  );
}
