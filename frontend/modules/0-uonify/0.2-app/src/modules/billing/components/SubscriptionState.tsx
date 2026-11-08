import { useState } from 'react';
import { api, errorMessage } from '@/shared/api/client';

export interface SubscriptionStateData {
  status: string;
  cancelAtPeriodEnd: boolean;
  interval: 'monthly' | 'annual';
  trialEndsAt: string | null;
  periodEndsAt: string | null;
}
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : '';

export function SubscriptionState({ subscription, onChange }: { subscription: SubscriptionStateData; onChange: () => Promise<unknown> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const trial = subscription.status === 'trialing';
  const cancel = async () => {
    setBusy(true); setMessage('');
    try {
      await api.post('/billing/subscription/cancel', {}, { signal: AbortSignal.timeout(30_000) });
      await onChange(); setConfirm(false);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="bil-onboard-offer" aria-label="Estado de tu suscripción">
    <h3>{subscription.cancelAtPeriodEnd ? 'Renovación cancelada' : trial ? 'Tu prueba está activa' : subscription.status === 'active' ? 'Tu suscripción está activa' : 'Revisa tu suscripción'}</h3>
    <p>{trial ? `Tu prueba gratuita termina el ${date(subscription.trialEndsAt)}.` : `Tu modalidad es ${subscription.interval === 'annual' ? 'anual' : 'mensual'}.`}</p>
    {subscription.cancelAtPeriodEnd ? <p>No habrá una nueva renovación. Conservas el acceso hasta el {date(subscription.periodEndsAt ?? subscription.trialEndsAt)} y tu trabajo seguirá guardado.</p> : <>
      <p>Puedes cancelar la renovación aquí. Durante la prueba no se cobra la suscripción.</p>
      {confirm && <p>¿Quieres cancelar la renovación? Conservarás el periodo vigente. Esto no cancela tus servicios de Google.</p>}
      <button className="uon-onboard-back" disabled={busy} onClick={() => confirm ? void cancel() : setConfirm(true)}>{busy ? 'Cancelando…' : confirm ? 'Confirmar cancelación' : 'Cancelar renovación'}</button>
      {confirm && <button className="uon-onboard-back" disabled={busy} onClick={() => setConfirm(false)}>Mantener mi suscripción</button>}
    </>}
    <p role="status">{message}</p>
  </section>;
}
