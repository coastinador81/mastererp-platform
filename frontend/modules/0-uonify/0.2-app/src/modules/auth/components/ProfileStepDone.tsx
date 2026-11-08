import type { BillingInterval } from '@/modules/billing';
import { Icon } from '@/shared/ui';
import { useAuthSession } from '../hooks/useSession';
import { missingConsents } from '../model/legal';
import { isPaidPlan, PLAN_LABELS, SALES_EMAIL } from '../model/plans';
import type { PlanId } from '../model/types';
import { useAuthUi } from '../state/authUi';

function planDetail(plan: PlanId, interval: BillingInterval): string {
  if (plan === 'free') return 'Sin coste. Puedes cambiar de plan cuando quieras.';
  if (plan === 'custom') return `Te escribiremos desde ${SALES_EMAIL} para preparar tu propuesta.`;
  return `Antes de acceder a tu espacio completarás el pago ${interval === 'monthly' ? 'mensual' : 'anual'}. Verás el importe y el periodo antes de confirmar.`;
}

/** Paso 6 · Listo: resumen de lo elegido antes de entrar en el espacio. */
export function ProfileStepDone({ hidden }: { hidden: boolean }) {
  const { firstName, lastName, email, plan, billingInterval = 'monthly' } = useAuthUi(state => state.profile.values);
  const { consents, chatgptPlan } = useAuthSession();
  const connected = chatgptPlan.status === 'connected';
  const termsAccepted = missingConsents(consents).length === 0;
  const name = firstName.trim();
  return (
    <section className="uon-onboard-step" data-onboard-step="5" hidden={hidden}>
      <h2 id="uon-profile-done-title" tabIndex={-1} data-step-focus>
        {name ? `Todo preparado, ${name}` : 'Todo preparado'}
      </h2>
      <p id="uon-profile-done-intro" className="uon-onboard-intro">
        {isPaidPlan(plan) ? 'Revisa el resumen y continúa al pago para activar tu espacio.' : 'Revisa el resumen y entra en tu espacio. Podrás cambiarlo todo en Configuración.'}
      </p>
      <dl className="uon-done-summary">
        <div>
          <dt>Tus datos</dt>
          <dd>{[`${name} ${lastName.trim()}`.trim(), email].filter(Boolean).join(' · ')}</dd>
        </div>
        <div>
          <dt>Condiciones</dt>
          <dd>{termsAccepted ? 'Aceptadas: Condiciones del servicio, Política de privacidad y Modelos de IA de terceros.' : 'Pendientes de aceptar.'}</dd>
        </div>
        <div>
          <dt>
            <Icon name="uony" size={14} /> Uony
          </dt>
          <dd>
            {connected
              ? `Con tu plan de ChatGPT${chatgptPlan.email ? ` (${chatgptPlan.email})` : ''}. Puedes desconectarlo en Configuración › Conexiones.`
              : isPaidPlan(plan)
                ? 'Con los tokens de Uonify de tu plan. Puedes conectar tu plan de ChatGPT en Configuración › Conexiones.'
                : 'Conecta tu plan de ChatGPT o contrata un plan para usar Uony. Lo tienes en Configuración.'}
          </dd>
        </div>
        <div>
          <dt>Tu plan</dt>
          <dd>
            {PLAN_LABELS[plan]}. {planDetail(plan, billingInterval)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
