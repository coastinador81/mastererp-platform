import { createElement } from 'react';
import { errorMessage } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { dialog, toast } from '@/shared/ui';
import { billingApi } from '../api/billingApi';
import { SalesBody } from '../components/checkout/SalesBody';
import { billingKeys, refreshBilling } from '../hooks/useBilling';
import { longDate } from '../model/money';
import { planChange, type BillingPlan, type PlanId, type BillingInterval } from '../model/plans';
import { intervalLabel, subscriptionInterval } from '../model/interval';
import { openBillingDialog } from './dialogs';

/**
 * Resultado de startCheckout: «paid» (plan pagado), «scheduled» (bajada programada
 * para la renovación), «sales» (Personalizado: hablar con ventas), «unchanged»
 * (ya tenía ese plan) o «cancelled».
 */
export type CheckoutOutcome = 'paid' | 'scheduled' | 'sales' | 'unchanged' | 'cancelled';

async function loadContext() {
  const [plans, subscription] = await Promise.all([
    queryClient.fetchQuery({ queryKey: billingKeys.plans, queryFn: billingApi.plans, staleTime: 60_000 }),
    queryClient.fetchQuery({ queryKey: billingKeys.subscription, queryFn: billingApi.subscription, staleTime: 5_000 }),
  ]);
  const name = (id: PlanId) => plans.find(plan => plan.id === id)?.name ?? id;
  return { plans, subscription, name };
}

/** Personalizado: no se paga con tarjeta, se habla con ventas. */
export function openSales(): void {
  dialog.open({
    title: 'Hablar con ventas',
    description: 'Plan Personalizado',
    body: createElement(SalesBody),
    size: 'sm',
    actions: [{ label: 'Cerrar' }],
  });
}

/** Bajar de plan (o pasar a Gratis) se aplica al renovar: se pide confirmación. */
async function scheduleDowngrade(target: BillingPlan | undefined, targetId: PlanId, currentName: string, renewsAt: string | null, interval: BillingInterval): Promise<CheckoutOutcome> {
  const name = `${target?.name ?? targetId}${targetId === 'free' ? '' : ` · ${intervalLabel(interval).toLowerCase()}`}`;
  const when = renewsAt ? `el ${longDate(renewsAt)}` : 'al terminar tu periodo';
  const ok = await dialog.confirm({
    title: targetId === 'free' ? 'Pasar al plan Gratis' : `Cambiar al plan ${name}`,
    description: `Sigues con ${currentName} hasta ${when}, que ya está pagado. Ese día tu cuenta pasa a ${name}. No se borra nada.`,
    confirmLabel: targetId === 'free' ? 'Pasar a Gratis al renovar' : `Cambiar a ${name} al renovar`,
    cancelLabel: `Seguir con ${currentName}`,
  });
  if (!ok) return 'cancelled';
  try {
    await billingApi.scheduleChange(targetId, interval);
    await refreshBilling(queryClient);
    toast.success(`Cambio a ${name} programado`, { description: `Hasta ${when} sigues con ${currentName}.` });
    return 'scheduled';
  } catch (error) {
    toast.error('No se ha podido programar el cambio', { description: errorMessage(error) });
    return 'cancelled';
  }
}

/**
 * Abre el pago de un plan mensual o anual: diálogo tipo Stripe
 * con el precio, «Impuestos no incluidos», el IVA, las casillas legales y la
 * confirmación. Lo llaman el alta («Elige tu plan»), Configuración y el muro de pago.
 * Subir de plan se paga ya; bajar se programa para la renovación.
 */
export async function startCheckout(planId: PlanId, interval: BillingInterval = 'monthly'): Promise<CheckoutOutcome> {
  if (planId === 'custom') {
    openSales();
    return 'sales';
  }
  let context: Awaited<ReturnType<typeof loadContext>>;
  try {
    context = await loadContext();
  } catch (error) {
    toast.error('No se ha podido abrir el pago', { description: errorMessage(error) });
    return 'cancelled';
  }
  const { plans, subscription, name } = context;
  const change = planChange(subscription.planId, planId);
  if (change === 'current' && (planId === 'free' || subscriptionInterval(subscription) === interval)) {
    toast.info(`Ya tienes el plan ${name(planId)}.`);
    return 'unchanged';
  }
  if (change === 'downgrade' || change === 'current' || (subscription.planId !== 'free' && subscriptionInterval(subscription) !== interval)) {
    return scheduleDowngrade(plans.find(plan => plan.id === planId), planId, name(subscription.planId), subscription.renewsAt, interval);
  }
  const outcome = await openBillingDialog({ kind: 'checkout', planId, interval });
  return outcome === 'done' ? 'paid' : 'cancelled';
}

/** Cancela una bajada programada y mantiene el plan actual al renovar. */
export async function keepCurrentPlan(): Promise<void> {
  try {
    await billingApi.scheduleChange(null);
    await refreshBilling(queryClient);
    toast.success('Mantienes tu plan al renovar');
  } catch (error) {
    toast.error('No se ha podido cancelar el cambio', { description: errorMessage(error) });
  }
}

/** Recarga de tokens de Uonify (desde 20 €). */
export async function openRecharge(): Promise<'recharged' | 'cancelled'> {
  return (await openBillingDialog({ kind: 'recharge' })) === 'done' ? 'recharged' : 'cancelled';
}

export function openWithdrawal(): Promise<unknown> {
  return openBillingDialog({ kind: 'withdrawal' });
}

export function openSupport(): Promise<unknown> {
  return openBillingDialog({ kind: 'support' });
}

export function openPaymentMethod(): Promise<unknown> {
  return openBillingDialog({ kind: 'payment-method' });
}

/** Dejar de apoyar a Uonify (se pide confirmación). */
export async function stopSupport(): Promise<void> {
  const ok = await dialog.confirm({
    title: 'Dejar de apoyar a Uonify',
    description: 'Dejarás de ser partner voluntario y no se te cobrará el próximo mes. Gracias por habernos apoyado.',
    confirmLabel: 'Dejar de apoyar',
    cancelLabel: 'Seguir apoyando',
    destructive: true,
  });
  if (!ok) return;
  try {
    await billingApi.stopSupport();
    await refreshBilling(queryClient);
    toast.success('Has dejado de apoyar a Uonify');
  } catch (error) {
    toast.error('No se ha podido cancelar el apoyo', { description: errorMessage(error) });
  }
}
