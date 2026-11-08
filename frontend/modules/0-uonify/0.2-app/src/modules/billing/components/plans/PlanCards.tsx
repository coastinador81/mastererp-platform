import clsx from 'clsx';
import { Badge, Button } from '@/shared/ui';
import { euros, eurosShort, tokens } from '../../model/money';
import { annualPrice, isPaidPlan, PAID_MONTHS, planChange, type BillingPlan, type BillingInterval, type PlanId } from '../../model/plans';

export interface PlanCardsProps {
  plans: BillingPlan[];
  /** Plan actual de la cuenta (marca «Tu plan» y decide subir o bajar). */
  currentId: PlanId;
  interval: BillingInterval;
  currentInterval?: BillingInterval;
  onChoose: (planId: PlanId) => void;
  /** Plan cuyo botón es el sólido de la vista (null: todos con borde). */
  primaryId?: PlanId | null;
  id?: string;
  /** Nivel del nombre del plan: h3 dentro de un diálogo, h4 en Configuración. */
  headingLevel?: 'h3' | 'h4';
  'aria-label'?: string;
}

function actionLabel(plan: BillingPlan, currentId: PlanId): string | null {
  switch (planChange(currentId, plan.id)) {
    case 'current':
      return null;
    case 'sales':
      return 'Hablar con ventas';
    case 'upgrade':
      return `Elegir ${plan.name}`;
    default:
      return plan.id === 'free' ? 'Pasar a Gratis' : `Cambiar a ${plan.name}`;
  }
}

/**
 * Tarjetas de planes (Configuración y muro de pago): precio mensual con
 * facturación anual, lo que se cobra al año, «13 meses por el precio de 12»,
 * usuarios, límites y tokens incluidos. Los textos vienen del catálogo de admin.
 */
export function PlanCards({ plans, currentId, interval, currentInterval = 'annual', onChoose, primaryId = null, id, headingLevel: Heading = 'h4', ...rest }: PlanCardsProps) {
  return (
    <ul className="bil-plans" id={id} aria-label={rest['aria-label']}>
      {plans.map(plan => {
        const current = plan.id === currentId && (plan.id === 'free' || interval === currentInterval);
        const action = !current && plan.id === currentId ? `Cambiar a pago ${interval === 'monthly' ? 'mensual' : 'anual'}` : actionLabel(plan, currentId);
        const annual = annualPrice(plan);
        const paid = isPaidPlan(plan);
        const titleId = `${id ?? 'bil-plan'}-${plan.id}`;
        return (
          <li key={plan.id} className={clsx('bil-plan', current && 'is-current', plan.popular && 'is-popular')}>
            <div className="bil-plan-head">
              <Heading id={titleId} className="bil-plan-name">
                {plan.name}
              </Heading>
              {current ? <Badge tone="blue">Tu plan</Badge> : plan.popular ? <Badge tone="outline">Más elegido</Badge> : null}
            </div>
            <p className="bil-plan-price">
              {plan.monthlyPrice === null ? (
                'A medida'
              ) : (
                <>
                  {eurosShort(plan.monthlyPrice)}
                  <small>/mes</small>
                </>
              )}
            </p>
            {paid && annual !== null ? (
              <p className="bil-plan-billing">
                {interval === 'monthly' ? `Facturación mensual · ${euros(plan.monthlyPrice ?? 0)} cada mes` : `Pago anual · ${euros(annual)} por periodo`}
                {interval === 'annual' ? <span className="bil-plan-bonus">
                  {plan.monthsPerYear} meses por el precio de {PAID_MONTHS}
                </span> : null}
              </p>
            ) : (
              <p className="bil-plan-billing">{plan.contactSales ? 'Precio según lo que necesites' : 'Sin cobros'}</p>
            )}
            <p className="bil-plan-description">{plan.description}</p>
            <ul className="bil-plan-facts">
              <li>{plan.limits}</li>
              {plan.includedTokens ? <li>{tokens(plan.includedTokens)} de Uonify al mes incluidos</li> : null}
            </ul>
            {action ? (
              <Button
                className="bil-plan-action"
                variant={plan.id === primaryId ? 'primary' : 'outline'}
                block
                onClick={() => onChoose(plan.id)}
              >
                {action}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
