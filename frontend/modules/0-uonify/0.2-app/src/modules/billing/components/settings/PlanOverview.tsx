import { useId, useState } from 'react';
import { Alert, Badge, Button, LinkButton, Section, SectionHead } from '@/shared/ui';
import { keepCurrentPlan, openWithdrawal, startCheckout } from '../../flows/checkout';
import { euros, eurosShort, longDate, shortDate } from '../../model/money';
import { annualPrice, PAID_MONTHS, type BillingPlan, type BillingInterval } from '../../model/plans';
import type { Subscription } from '../../model/types';
import { subscriptionInterval, intervalLabel } from '../../model/interval';
import { BillingIntervalPicker } from '../plans/BillingIntervalPicker';
import { PlanCards } from '../plans/PlanCards';

export interface PlanOverviewProps {
  subscription: Subscription;
  plans: BillingPlan[];
  /** Este bloque lleva el botón sólido de la vista (en Gratis, «Ver planes»). */
  primary: boolean;
  now?: Date;
}

/**
 * Plan actual: precio, «13 meses por el precio de 12», renovación, cambio
 * programado, plazo de desistimiento y el selector para cambiar de plan.
 */
export function PlanOverview({ subscription, plans, primary, now = new Date() }: PlanOverviewProps) {
  const currentInterval = subscriptionInterval(subscription);
  const [interval, setInterval] = useState<BillingInterval>(subscription.planId === 'free' ? 'monthly' : currentInterval);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const pickerId = useId();
  const plan = plans.find(item => item.id === subscription.planId);
  const name = plan?.name ?? subscription.planId;
  const free = subscription.planId === 'free';
  const annual = plan ? annualPrice(plan) : null;
  const renewal = currentInterval === 'monthly' ? plan?.monthlyPrice : annual;
  const scheduled = subscription.scheduledPlanId ? plans.find(item => item.id === subscription.scheduledPlanId) : undefined;
  const canWithdraw = !free && !!subscription.withdrawalUntil && now.getTime() <= new Date(subscription.withdrawalUntil).getTime();

  return (
    <Section aria-labelledby={titleId} className="bil-block">
      <SectionHead
        titleId={titleId}
        icon="star"
        title="Tu plan"
        actions={
          <Button variant={primary ? 'primary' : 'outline'} aria-expanded={open} aria-controls={pickerId} onClick={() => setOpen(value => !value)}>
            {open ? 'Ocultar planes' : free ? 'Ver planes' : 'Cambiar plan'}
          </Button>
        }
      />
      <div className="bil-current">
        <div className="bil-current-head">
          <strong className="bil-current-name">Plan {name}</strong>
          {free ? <Badge>Gratis</Badge> : <Badge tone="blue">{intervalLabel(currentInterval)}</Badge>}
        </div>
        {free ? (
          <p className="bil-current-text">
            Uonify es gratis para empezar. Cuando uses algo que tiene un coste para Uonify, como crear vídeos, A+ o modelos 3D, o descargar
            contenido, te pediremos un plan.
          </p>
        ) : (
          <>
            {plan?.monthlyPrice != null && annual !== null ? (
              <p className="bil-current-price">
                {currentInterval === 'monthly' ? `${eurosShort(plan.monthlyPrice)} + IVA al mes` : `${euros(annual)} + IVA por periodo anual`}
              </p>
            ) : null}
            {subscription.startedAt && subscription.renewsAt ? (
              <p className="bil-current-text">
                {currentInterval === 'monthly' ? 'Pago mensual' : `${subscription.months ?? PAID_MONTHS + 1} meses por el precio de ${PAID_MONTHS}`}: tu periodo va del {shortDate(subscription.startedAt)} al{' '}
                {shortDate(subscription.renewsAt)}.
              </p>
            ) : null}
            {subscription.renewsAt ? (
              scheduled ? (
                <p className="bil-current-text">
                  El {longDate(subscription.renewsAt)} pasarás al plan {scheduled.name}{scheduled.id !== 'free' ? ` con pago ${intervalLabel(subscription.scheduledInterval ?? currentInterval).toLowerCase()}` : ''}.{' '}
                  <LinkButton onClick={() => void keepCurrentPlan()}>Mantener {name}</LinkButton>
                </p>
              ) : (
                <p className="bil-current-text">
                  Se renueva el {longDate(subscription.renewsAt)} por {renewal != null ? `${euros(renewal)} + IVA` : 'el precio del plan'}.
                </p>
              )
            ) : null}
          </>
        )}
        {canWithdraw && subscription.withdrawalUntil ? (
          <Alert tone="info" role="note" className="bil-withdrawal-note" title={`Puedes desistir hasta el ${longDate(subscription.withdrawalUntil)}`}>
            <p>Te devolvemos lo pagado menos los tokens de Uonify del plan que hayas gastado, a precio de tarifa.</p>
            <Button size="sm" variant="danger" icon="rotate-ccw" onClick={() => void openWithdrawal()}>
              Desistir del plan
            </Button>
          </Alert>
        ) : null}
      </div>
      <div id={pickerId} hidden={!open} className="bil-picker">
        {open ? (
          <>
            <BillingIntervalPicker value={interval} onChange={setInterval} />
            <PlanCards interval={interval} currentInterval={currentInterval} id={`${pickerId}-plans`} aria-label="Planes de Uonify" plans={plans} currentId={subscription.planId} onChoose={planId => void startCheckout(planId, interval)} />
            <p className="bil-fine">
              Precios sin IVA. Elige pago mensual o anual. Subir de plan con la misma modalidad se paga hoy,
              descontando lo que no has usado del actual; bajar o cambiar la modalidad de pago se aplica al renovar.
            </p>
          </>
        ) : null}
      </div>
    </Section>
  );
}
