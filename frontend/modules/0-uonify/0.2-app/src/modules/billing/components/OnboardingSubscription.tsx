import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/shared/api/client';
import { InformationDisclosure } from '@/shared/ui';
import { SubscriptionState } from './SubscriptionState';
import { EmbeddedCheckout } from './EmbeddedCheckout';
import { onboardingMoney as money, type CheckoutStatus, type EmbeddedCheckoutSession, type OnboardingInterval, type OnboardingOffer } from '../model/onboarding';
import '../styles/onboarding-subscription.css';

/** Aviso pre-contractual de cobros adicionales (texto final de Legal). Se muestra en el paso de pago,
 *  antes de suscribirse; nunca en la página de precios. La cláusula completa vive en los Términos. */
const AVISO_PRECONTRACTUAL = 'La suscripción incluye los servicios de Uonify. Algunos servicios pueden ofrecer recursos adicionales de pago, siempre opcionales y con tu confirmación previa; verás el precio con impuestos antes de pagar.';

interface Props {
  account: string;
  onContinue?: () => Promise<void>;
  onBack?: () => void;
  compact?: boolean;
  /** Conserva la confirmación de Stripe aunque se actualice el progreso del alta. */
  onPaymentOpen?: (open: boolean) => void;
  /** Índice humano, empezando en 1; la barra general integra estos apartados. */
  onProgress?: (progress: { id: string; label: string; index: number; total: number }) => void;
}

/** Cambiar de cuenta destruye el formulario Stripe y descarta las respuestas tardías. */
export function OnboardingSubscription(props: Props) {
  return <SubscriptionStep key={props.account} {...props} />;
}

function SubscriptionStep({ account, onContinue, onBack, compact = false, onProgress, onPaymentOpen }: Props) {
  const cache = useQueryClient();
  const key = ['onboarding-offer', account];
  const active = useRef(true);
  const locked = useRef(false);
  const abort = useRef(new AbortController());
  useEffect(() => {
    active.current = true; abort.current = new AbortController();
    return () => { active.current = false; abort.current.abort(); };
  }, []);
  const offer = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    if (new URLSearchParams(window.location.search).get('billing') === 'return') await api.post('/billing/subscription/refresh', {}, { signal });
    return api.get<OnboardingOffer>('/billing/onboarding-offer', { signal });
  }, staleTime: 0, retry: false });
  const [choice, setChoice] = useState<OnboardingInterval | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<EmbeddedCheckoutSession | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  useEffect(() => { onPaymentOpen?.(!!session); }, [session, onPaymentOpen]);
  useEffect(() => () => { onPaymentOpen?.(false); }, [onPaymentOpen]);
  const [reviewing, setReviewing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const subscriptionState = !!offer.data?.subscription && !['canceled', 'incomplete_expired'].includes(offer.data.subscription.status);
  const progressIndex = paymentConfirmed ? 5 : session ? 4 : subscriptionState ? 5 : authorizing ? 3 : reviewing || offer.data?.checkoutInterval ? 2 : 1;
  useEffect(() => {
    const stages = [
      ['subscription-choice', 'Elegir modalidad'], ['subscription-review', 'Revisar suscripción'],
      ['subscription-consent', 'Autorizar suscripción'], ['subscription-payment', 'Pago seguro'],
      ['subscription-state', 'Estado de tu suscripción'],
    ];
    const [id, label] = stages[progressIndex - 1];
    onProgress?.({ id, label, index: progressIndex, total: stages.length });
  }, [progressIndex, onProgress]);
  const options = () => ({ signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(60_000)]) });
  const run = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { return await operation(); }
    catch (error) { if (active.current) setMessage(errorMessage(error)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  const checkPayment = async (advance = false) => (await run(async () => {
    const result = await api.post<CheckoutStatus>('/billing/checkout-status', {}, options());
    if (!active.current) return;
    const expired = result.access.status !== 'allowed' && result.checkoutStatus === 'expired';
    // El rechazo de esta sesión ya es definitivo, aunque falle la lectura posterior del plan.
    if (expired) { setSession(null); setAccepted(false); setReviewing(true); setAuthorizing(false); }
    await offer.refetch({ throwOnError: true });
    if (!active.current) return false;
    if (result.access.status === 'allowed') {
      setPaymentConfirmed(true);
      // El callback de Stripe confirma; solo una acción del cliente cierra su recibo.
      if (advance) {
        if (onContinue) await onContinue();
        if (active.current) setSession(null);
      } else setMessage('Tu pago está confirmado. Puedes leer la confirmación y continuar cuando quieras.');
      return true;
    }
    setPaymentConfirmed(false);
    if (expired) {
      setMessage('El formulario anterior ha caducado. Revisa las condiciones para abrir otro.');
      return false;
    }
    setMessage('Todavía no tenemos la confirmación del pago. Puedes comprobarlo de nuevo sin iniciar otro.');
    return false;
  })) ?? false;
  const refresh = () => checkPayment(true);
  if (offer.isPending) return <p role="status">Recuperando tu suscripción…</p>;
  if (offer.isError && !session) return <div role="status"><p>No hemos podido cargar tu plan.</p><button className="uon-onboard-back" onClick={() => void offer.refetch()}>Reintentar</button></div>;
  const data = offer.data!;
  const interval = data.checkoutInterval ?? choice ?? data.selection?.interval ?? 'annual';
  const price = session?.summary.baseCents ?? (interval === 'annual' ? data.offer.annualCents : data.offer.monthlyCents);
  const tax = session?.summary.taxCents ?? (data.taxRatePercent === undefined ? null : Math.round(price * data.taxRatePercent / 100));
  const total = tax === null ? null : price + tax;
  const trial = session ? session.summary.trialDays > 0 : !data.trialUsed;
  const period = interval === 'annual' ? 'año' : 'mes';
  const saved = data.selection?.interval === interval && data.selection.offerVersion === data.offer.version;
  if (subscriptionState && data.subscription && !session) return <>
    <SubscriptionState subscription={data.subscription} onChange={() => offer.refetch({ throwOnError: true })} />
    {onContinue && <button className="uon-profile-submit" disabled={busy} onClick={() => void refresh()}>{busy ? 'Confirmando…' : 'Continuar con Uony'}</button>}
    <p role="status">{message}</p>
  </>;
  const prepare = () => run(async () => {
    const result = await api.put<OnboardingOffer>('/billing/onboarding-selection', { interval, offerVersion: data.offer.version }, options());
    if (!active.current) return;
    cache.setQueryData(key, result);
    if (!result.embeddedReady) { setMessage('Tu modalidad está guardada. El pago integrado aún no está disponible; la prueba no ha comenzado.'); return; }
    const prepared = await api.post<EmbeddedCheckoutSession>('/billing/checkout-embedded', { acceptRenewal: true, interval, offerVersion: data.offer.version }, options());
    if (!active.current) return;
    setPaymentConfirmed(false); setSession(prepared); await offer.refetch();
  });
  const changeInterval = () => run(async () => {
    await api.post('/billing/checkout/abandon', {}, options());
    if (!active.current) return;
    setSession(null); setAccepted(false);
    if (compact) { setReviewing(false); setAuthorizing(false); }
    await offer.refetch({ throwOnError: true });
  });
  const choices = <fieldset disabled={busy || !!data.checkoutInterval}>
    <legend>Elige tu modalidad</legend>
    {(['annual', 'monthly'] as const).map(value => <label key={value} className={interval === value ? 'is-selected' : ''}>
      <input type="radio" name="uonify-interval" value={value} checked={interval === value} onChange={() => { setChoice(value); setAccepted(false); setMessage(''); }} />
      <span><strong>{value === 'annual' ? 'Anual' : 'Mensual'}</strong><span>{money(value === 'annual' ? data.offer.annualCents : data.offer.monthlyCents)} al {value === 'annual' ? 'año' : 'mes'} + IVA</span></span>
    </label>)}
  </fieldset>;
  if (session) return <section className="bil-onboard-offer bil-onboard-payment" data-activation-payment="true" aria-label="Tu suscripción Uonify">
    <h3>Pago seguro con Stripe</h3>
    <p>{trial ? `${session.summary.trialDays} días de prueba · Hoy ${money(session.summary.dueTodayCents)}` : `Hoy ${money(session.summary.dueTodayCents)}`} · {money(session.summary.totalCents)} / {period}{trial ? ' después de la prueba' : ''}.</p>
    <EmbeddedCheckout session={session} onComplete={() => void checkPayment()} onCheckStatus={() => checkPayment()} confirmed={paymentConfirmed} confirming={busy} onContinue={async () => { await refresh(); }} />
    {!paymentConfirmed && <button className="uon-onboard-back" disabled={busy} onClick={() => setSession(null)}>Cerrar el formulario y continuar más tarde</button>}
    {message && <p role="status">{message}</p>}
  </section>;
  if (compact) {
    const choosing = !reviewing && !data.checkoutInterval;
    const backToChoice = () => { setReviewing(false); setAuthorizing(false); setAccepted(false); };
    return <section className="bil-onboard-offer bil-onboard-compact" aria-label="Tu suscripción Uonify">
      {choosing ? <>
        <h3>Tu espacio está preparado</h3>
        <p>Tu suscripción incluye las herramientas y agentes de Uonify para preparar y gestionar tus productos con Uony desde el chat. El consumo de Google se paga aparte, desde tu cuenta.</p>
        {choices}
        <div className="bil-onboard-actions">
          {onBack && <button className="uon-onboard-back" type="button" onClick={onBack} aria-label="Volver a la preparación">Volver</button>}
          <button className="uon-profile-submit" type="button" onClick={() => setReviewing(true)}>Revisar suscripción</button>
        </div>
      </> : !authorizing ? <>
        <h3>Revisa tu suscripción</h3>
        <dl className="bil-onboard-summary">
          <div><dt>Suscripción</dt><dd>{money(price)} / {period}</dd></div>
          {tax !== null && <div><dt>IVA ({data.taxRatePercent} %)</dt><dd>{money(tax)}</dd></div>}
          <div><dt>Hoy</dt><dd><strong>{trial ? money(0) : total === null ? `${money(price)} + IVA` : money(total)}</strong></dd></div>
          <div><dt>{trial ? 'Tras la prueba' : 'Cada renovación'}</dt><dd>{total === null ? `${money(price)} + IVA` : money(total)} / {period}</dd></div>
        </dl>
        {data.taxScope === 'sandbox_fixed_21' && <p className="bil-onboard-test-note">Prueba técnica: IVA de ejemplo del 21 %. Sin cargos reales.</p>}
        {trial ? <p><strong>{data.offer.trialDays} días gratis desde la confirmación en Stripe.</strong> Si cancelas durante la prueba, no pagarás. Te avisaremos {data.offer.reminderDays} días antes del primer cobro.</p> : <p><strong>Ya has utilizado la prueba gratuita.</strong> Al confirmar se cobrará el importe de hoy.</p>}
        {data.checkoutMode === 'hosted' && <p>Hay un pago anterior abierto. Ciérralo para continuar con el pago integrado.</p>}
        <div className="bil-onboard-actions">
          {!data.checkoutInterval && <button className="uon-onboard-back" type="button" disabled={busy} onClick={backToChoice}>Cambiar modalidad</button>}
          {data.checkoutMode === 'hosted' ? <button className="uon-profile-submit" disabled={busy} onClick={() => void changeInterval()}>Cerrar el pago anterior</button> : <button className="uon-profile-submit" type="button" onClick={() => setAuthorizing(true)}>Continuar a la autorización</button>}
        </div>
      </> : <>
        <h3>Autoriza tu suscripción</h3>
        <p><strong>Hoy {trial ? money(0) : total === null ? `${money(price)} + IVA` : money(total)}.</strong> {trial ? `Tras los ${data.offer.trialDays} días de prueba: ` : 'Renovaciones: '}{total === null ? `${money(price)} + IVA` : `${money(total)} con IVA`} / {period}.</p>
        <label className="bil-onboard-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>Autorizo las renovaciones de esta suscripción. Puedo cancelarlas desde mi cuenta.</span></label>
        <p className="bil-onboard-legal">{AVISO_PRECONTRACTUAL}</p>
        <InformationDisclosure label="Pago seguro y condiciones"><p>Stripe recoge tu tarjeta de forma segura. Uonify no guarda sus datos. Verás la fecha del primer cobro antes de confirmar en Stripe.</p><p>{trial ? 'Si cancelas durante la prueba, no pagarás la suscripción.' : 'Al confirmar se cobrará el importe de hoy.'}</p></InformationDisclosure>
        <div className="bil-onboard-actions">
          <button className="uon-onboard-back" type="button" disabled={busy} onClick={() => { setAuthorizing(false); setAccepted(false); }} aria-label="Volver a las condiciones">Volver</button>
          <button className="uon-profile-submit" type="button" disabled={busy || (data.embeddedReady ? !accepted : saved)} aria-busy={busy || undefined} onClick={() => void prepare()}>{busy ? 'Preparando…' : !data.embeddedReady ? saved ? 'Modalidad guardada' : 'Guardar modalidad' : data.checkoutInterval ? 'Retomar pago seguro' : trial ? 'Continuar con la prueba' : 'Continuar con el pago'}</button>
        </div>
      </>}
      {!choosing && data.checkoutInterval && <InformationDisclosure label="Opciones del pago iniciado">{data.checkoutMode !== 'hosted' && <button className="uon-onboard-back" disabled={busy} onClick={() => void changeInterval()}>Cambiar modalidad</button>}<button className="uon-onboard-back" disabled={busy} onClick={() => void refresh()}>Comprobar mi pago</button></InformationDisclosure>}
      {message && <p role="status">{message}</p>}
      {!data.embeddedReady && !choosing && <p role="status">El pago integrado aún no está disponible. Tu preparación está guardada.</p>}
    </section>;
  }
  return <section className="bil-onboard-offer" aria-label="Tu suscripción Uonify">
    <h3>Tu espacio está preparado</h3>
    <p>Tu suscripción incluye las herramientas y agentes de Uonify para preparar y gestionar tus productos con Uony desde el chat.</p>{choices}
    <dl className="bil-onboard-summary">
      <div><dt>Suscripción</dt><dd>{money(price)} / {period}</dd></div>
      {tax !== null && <div><dt>IVA ({data.taxRatePercent} %)</dt><dd>{money(tax)}</dd></div>}
      <div><dt>Hoy</dt><dd><strong>{trial ? money(0) : total === null ? `${money(price)} + IVA` : money(total)}</strong></dd></div>
      <div><dt>{trial ? 'Después de la prueba' : 'Cada renovación'}</dt><dd>{total === null ? `${money(price)} + IVA` : money(total)} / {period}</dd></div>
    </dl>
    {data.taxScope === 'sandbox_fixed_21' && <p className="bil-onboard-test-note">Entorno de pruebas: IVA de ejemplo del 21 %. No se realizan cargos reales.</p>}
    {trial ? <p><strong>{data.offer.trialDays} días gratis de Uonify.</strong> Empiezan al confirmar en Stripe. Verás allí la fecha del primer cobro antes de aceptar. Si cancelas durante la prueba, no pagarás la suscripción. Te avisaremos {data.offer.reminderDays} días antes del primer cobro.</p> : <p><strong>Ya has utilizado la prueba gratuita.</strong> Al confirmar se cobrará el importe de hoy.</p>}
    <p className="bil-onboard-legal">{AVISO_PRECONTRACTUAL}</p>
    {data.checkoutMode !== 'hosted' && <label className="bil-onboard-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>Autorizo las renovaciones de esta suscripción. Puedo cancelarlas desde mi cuenta.</span></label>}
    {data.checkoutMode === 'hosted' ? <><p>Hay un pago anterior abierto. Puedes comprobar si terminó o cerrarlo para continuar aquí con el pago integrado.</p><button className="uon-profile-submit" disabled={busy} onClick={() => void changeInterval()}>Cerrar el pago anterior</button></> : <button className="uon-profile-submit" type="button" disabled={busy || (data.embeddedReady ? !accepted : saved)} aria-busy={busy || undefined} onClick={() => void prepare()}>{busy ? 'Preparando…' : !data.embeddedReady ? saved ? 'Modalidad guardada' : 'Guardar modalidad' : data.checkoutInterval ? 'Retomar pago seguro' : trial ? 'Continuar con la prueba' : 'Continuar con el pago'}</button>}
    {data.checkoutInterval && <>{data.checkoutMode !== 'hosted' && <button className="uon-onboard-back" disabled={busy} onClick={() => void changeInterval()}>Cambiar modalidad</button>}<button className="uon-onboard-back" disabled={busy} onClick={() => void refresh()}>Comprobar mi pago</button></>}
    {onBack && <button className="uon-onboard-back" disabled={busy} onClick={onBack}>Volver a la preparación</button>}
    <p role="status">{message || (!data.embeddedReady ? 'El pago integrado aún no está disponible. Tu preparación está guardada.' : 'Stripe recoge tu tarjeta de forma segura. Uonify no guarda sus datos.')}</p>
  </section>;
}
