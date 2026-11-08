import clsx from 'clsx';
import { Alert, Badge, Button, Spinner } from '@/shared/ui';
import { usePlans, BillingIntervalPicker, type BillingInterval, type BillingPlan } from '@/modules/billing';
import { useAuthSession } from '../hooks/useSession';
import {
  annualLabel,
  hasBonusMonth,
  monthlyLabel,
  planNote,
  planSuggestion,
  SALES_EMAIL,
  SALES_MAILTO,
  uonyPlanNotice,
} from '../model/plans';
import { setProfileValue, useAuthUi } from '../state/authUi';

/**
 * Paso 5 · Elige tu plan. El catálogo es el de billing (usePlans, precios editables
 * desde admin). Mensuales y anuales; el anual ofrece 13 meses por el precio de 12; Gratis viene
 * elegido. Los de pago se pagan con startCheckout() al entrar en el espacio y
 * Personalizado va por ventas (hola@uonify.com).
 */
export function ProfileStepPlan({ hidden }: { hidden: boolean }) {
  const plan = useAuthUi(state => state.profile.values.plan);
  const interval = useAuthUi(state => state.profile.values.billingInterval ?? 'monthly');
  const companySize = useAuthUi(state => state.profile.values.companySize);
  const connected = useAuthSession().chatgptPlan.status === 'connected';
  const suggestion = planSuggestion(companySize);
  const notice = uonyPlanNotice(plan, connected);
  return (
    <section className="uon-onboard-step" data-onboard-step="4" hidden={hidden}>
      {/* El foco va al título: el catálogo puede estar cargándose todavía. */}
      <h2 id="uon-profile-plan-title" tabIndex={-1} data-step-focus>
        Elige tu plan
      </h2>
      <p id="uon-profile-plan-intro" className="uon-onboard-intro">
        Empieza gratis o elige un plan con pago mensual o anual.
      </p>
      <p className="uon-onboard-suggestion" id="uon-onboard-suggestion" hidden={!suggestion}>
        {suggestion}
      </p>
      {/* El catálogo solo se pide con el paso a la vista. */}
      {hidden ? null : <><BillingIntervalPicker value={interval} onChange={value => setProfileValue('billingInterval', value)} /><PlanChoices selected={plan} interval={interval} /></>}
      <p className="uon-onboard-plan-note" id="uon-onboard-plan-note">
        {planNote(plan, interval)}
      </p>
      {notice ? (
        <p className="uon-onboard-uony-note" id="uon-onboard-uony-note">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function PlanChoices({ selected, interval }: { selected: string; interval: BillingInterval }) {
  const { data: plans, isPending, isError, refetch } = usePlans();
  if (isPending) {
    return (
      <div className="uon-plan-loading">
        <Spinner label="Cargando los planes…" />
        <span aria-hidden="true">Cargando los planes…</span>
      </div>
    );
  }
  if (isError || !plans?.length) {
    return (
      <Alert tone="red" role="alert" title="No se pudieron cargar los planes">
        <p>Puedes seguir con Gratis o volver a intentarlo.</p>
        <Button size="sm" icon="refresh-cw" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  }
  return (
    <div className="uon-plan-grid" role="radiogroup" aria-label="Plan de Uonify">
      {plans.map(item => (
        <PlanOption key={item.id} plan={item} interval={interval} checked={selected === item.id} />
      ))}
    </div>
  );
}

function PlanOption({ plan, checked, interval }: { plan: BillingPlan; checked: boolean; interval: BillingInterval }) {
  const price = monthlyLabel(plan);
  const annual = annualLabel(plan);
  const custom = plan.contactSales || plan.monthlyPrice === null;
  return (
    <label className={clsx('uon-plan-card', custom && 'uon-plan-card-wide')}>
      <input
        type="radio"
        name="plan"
        value={plan.id}
        checked={checked}
        onChange={() => setProfileValue('plan', plan.id)}
      />
      <span className="uon-plan-name">{plan.name}</span>
      {price ? (
        <span className="uon-plan-price">
          {price}
          <small>/mes</small>
        </span>
      ) : (
        <span className="uon-plan-price uon-plan-price-custom">A medida</span>
      )}
      {annual ? <span className="uon-plan-billing">{interval === 'monthly' ? 'Facturación mensual' : `Pago anual · ${annual.replace(' al año', ' por periodo')}`}</span> : null}
      {interval === 'annual' && hasBonusMonth(plan) ? (
        <span className="uon-plan-bonus">
          <Badge tone="blue">{plan.monthsPerYear} meses por el precio de 12</Badge>
        </span>
      ) : null}
      <span className="uon-plan-description">{plan.description}</span>
      <span className="uon-plan-detail">{plan.limits}</span>
      {custom ? (
        <span className="uon-plan-sales">
          Habla con ventas: <a href={SALES_MAILTO}>{SALES_EMAIL}</a>
        </span>
      ) : null}
    </label>
  );
}
