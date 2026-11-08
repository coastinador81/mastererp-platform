import { useState } from 'react';
import type { PlanRequiredDetail } from '@/shared/api/planRequired';
import { Alert, Button, Dialog, Icon, LinkButton, Spinner } from '@/shared/ui';
import { settingsPath } from '@/modules/settings';
import { openSales, startCheckout } from '../../flows/checkout';
import { closeBillingDialog, openBillingDialog, useBillingDialogs } from '../../flows/dialogs';
import { goTo } from '../../flows/navigate';
import { useBalance, useBillingConfig, useSubscription } from '../../hooks/useBilling';
import { usePlans } from '../../hooks/usePlans';
import { euros, eurosShort, tokensLabel } from '../../model/money';
import { featureLabel, paywallCopy } from '../../model/paywall';
import { BillingIntervalPicker } from '../plans/BillingIntervalPicker';
import { subscriptionInterval } from '../../model/interval';
import { isPaidPlan, type BillingInterval } from '../../model/plans';
import { PlanCards } from '../plans/PlanCards';

/**
 * Aviso del muro de pago (402 del backend). plan_required: explica por qué con la
 * función que se intentaba usar y enseña los planes; tokens_required: ofrece
 * recargar tokens de Uonify o, si sirve, conectar ChatGPT. Solo ofrece opciones:
 * nunca cambia la forma de pago por su cuenta.
 */
export function PaywallDialog({ id, detail }: { id: number; detail: PlanRequiredDetail }) {
  const chatGptConnected = useBillingDialogs(state => state.chatGptConnected);
  const copy = paywallCopy(detail, chatGptConnected);
  const close = () => closeBillingDialog(id, 'cancelled');
  return (
    <Dialog
      open
      onClose={close}
      size={copy.code === 'plan_required' ? 'lg' : 'md'}
      title={copy.title}
      description={copy.lead}
      footer={<Button onClick={close}>Ahora no</Button>}
    >
      {copy.detail && copy.detail !== copy.lead ? <p className="bil-paywall-detail">{copy.detail}</p> : null}
      {copy.code === 'plan_required' ? <PlanChoice /> : <TokensChoice feature={detail.feature} offerChatGpt={copy.offerChatGpt} onClose={close} />}
    </Dialog>
  );
}

function PlanChoice() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const plans = usePlans();
  const subscription = useSubscription();
  if (plans.isPending || subscription.isPending) return <Spinner label="Cargando los planes…" />;
  if (plans.isError || !plans.data) {
    return (
      <Alert tone="red" role="alert">
        No se han podido cargar los planes. <LinkButton onClick={() => void plans.refetch()}>Reintentar</LinkButton>
      </Alert>
    );
  }
  const paid = plans.data.filter(isPaidPlan);
  const popular = paid.find(plan => plan.popular) ?? paid[0];
  return (
    <div className="bil-paywall">
      <BillingIntervalPicker value={interval} onChange={setInterval} />
      <PlanCards interval={interval} currentInterval={subscription.data ? subscriptionInterval(subscription.data) : undefined}
        id="bil-paywall-plans"
        aria-label="Planes de pago"
        headingLevel="h3"
        plans={paid}
        currentId={subscription.data?.planId ?? 'free'}
        primaryId={popular?.id ?? null}
        onChoose={planId => void startCheckout(planId, interval)}
      />
      <p className="bil-fine">
        Precios sin IVA. Elige pago mensual o anual. Puedes desistir en 14 días.{' '}
        <LinkButton onClick={openSales}>¿Varias marcas o un equipo grande? Habla con ventas</LinkButton>
      </p>
    </div>
  );
}

function TokensChoice({ feature, offerChatGpt, onClose }: { feature?: string; offerChatGpt: boolean; onClose: () => void }) {
  const balance = useBalance();
  const config = useBillingConfig();
  const label = featureLabel(feature);
  return (
    <div className="bil-paywall">
      {balance.data ? (
        <p className="bil-muted-line">
          Tienes <strong>{tokensLabel(balance.data.tokens, balance.data.tokenPrice)}</strong>.
        </p>
      ) : null}
      <div className="bil-options">
        <section className="bil-option" aria-labelledby="bil-paywall-recharge">
          <Icon name="bil-coins" size={20} className="bil-option-icon" />
          <div className="bil-option-text">
            <h3 id="bil-paywall-recharge">Recargar tokens de Uonify</h3>
            <p>
              {config.data
                ? `Desde ${eurosShort(config.data.minRecharge)}. Cada token vale ${euros(config.data.tokenPrice)}, sin packs ni descuentos.`
                : 'Recarga el importe que quieras, desde la recarga mínima.'}
            </p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => void openBillingDialog({ kind: 'recharge' })}>
            Recargar
          </Button>
        </section>
        {offerChatGpt ? (
          <section className="bil-option" aria-labelledby="bil-paywall-chatgpt">
            <Icon name="link" size={20} className="bil-option-icon" />
            <div className="bil-option-text">
              <h3 id="bil-paywall-chatgpt">Usar tu plan de ChatGPT</h3>
              <p>Conecta tu cuenta de ChatGPT y Uony la usará para {label}, sin gastar tokens de Uonify.</p>
            </div>
            <Button
              iconEnd="arrow-right"
              onClick={() => {
                onClose();
                goTo(settingsPath('conexiones'));
              }}
            >
              Conectar ChatGPT
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
