import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import type { StripeEmbeddedCheckout } from '@stripe/stripe-js';
import type { EmbeddedCheckoutSession } from '../model/onboarding';
import { embeddedFailure, type CheckoutPhase } from '../model/embeddedFailure';
import { reserveEmbeddedCheckout } from '../model/embeddedLease';
import { reportStripeFailure } from '../api/embeddedDiagnostics';
import { createEmbeddedCheckout } from '../model/embeddedSdk';

interface Props {
  session: EmbeddedCheckoutSession;
  onComplete: () => void;
  onCheckStatus?: () => Promise<boolean>;
  confirmed?: boolean;
  confirming?: boolean;
  onContinue?: () => Promise<void>;
}
type Failure = ReturnType<typeof embeddedFailure>;

/** Reintentar solo vuelve a montar esta sesión; nunca crea ni confirma un pago. */
export function EmbeddedCheckout({ session, onComplete, onCheckStatus, confirmed = false, confirming = false, onContinue }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onComplete, onCheckStatus, onContinue });
  const live = useRef(true);
  const checking = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  useEffect(() => { callbacks.current = { onComplete, onCheckStatus, onContinue }; }, [onComplete, onCheckStatus, onContinue]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const { clientSecret, publishableKey, checkoutAttemptId } = session;
  useEffect(() => {
    let disposed = false;
    let completed = false;
    let checkout: StripeEmbeddedCheckout | undefined;
    let release: (() => void) | undefined;
    let initializing = false;
    let phase: CheckoutPhase = 'configuration';
    const destroy = () => {
      const instance = checkout; checkout = undefined;
      // Stripe no admite reutilizar una instancia destruida ni destruirla dos veces.
      try { instance?.destroy(); } catch { /* Nunca mostrar errores que puedan contener secretos. */ }
    };
    const finish = () => { destroy(); release?.(); };
    const timer = window.setTimeout(() => { if (!disposed) setSlow(true); }, 15_000);
    const mount = async () => {
      setStatus('loading'); setFailure(null); setSlow(false); setCheckMessage('');
      if (!/^pk_test_[A-Za-z0-9]{16,240}$/.test(publishableKey)
        || typeof clientSecret !== 'string' || !clientSecret || clientSecret.length > 8192
        || Array.from(clientSecret).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error();
      release = await reserveEmbeddedCheckout();
      if (disposed) { release(); return; }
      phase = 'script';
      const stripe = await loadStripe(publishableKey, { locale: 'es' });
      if (disposed) { release(); return; }
      if (!stripe) throw new Error();
      phase = 'initialization';
      initializing = true;
      try {
        checkout = await createEmbeddedCheckout(stripe, { clientSecret, onComplete: () => {
          if (!disposed && !completed) { completed = true; callbacks.current.onComplete(); }
        } });
      } finally { initializing = false; }
      if (disposed) { finish(); return; }
      phase = 'mount';
      if (!host.current?.isConnected) throw new Error();
      checkout.mount(host.current);
      window.clearTimeout(timer); setStatus('ready'); setSlow(false);
    };
    void mount().catch(error => {
      window.clearTimeout(timer); finish();
      if (!disposed) {
        const detail = embeddedFailure(error, phase);
        reportStripeFailure(checkoutAttemptId, phase, detail.code, error, [clientSecret, publishableKey]);
        setFailure(detail); setStatus('failed'); setSlow(false);
      }
    });
    // La promesa de init no se puede cancelar: liberar ahora permitiría otro init simultáneo.
    return () => { disposed = true; window.clearTimeout(timer); if (!initializing) finish(); };
  }, [clientSecret, publishableKey, checkoutAttemptId, attempt]);
  const checkStatus = async () => {
    if (checking.current || confirming || !(confirmed ? callbacks.current.onContinue : callbacks.current.onCheckStatus)) return;
    checking.current = true; setBusy(true); setCheckMessage('');
    try {
      if (confirmed) await callbacks.current.onContinue?.();
      else await callbacks.current.onCheckStatus?.();
    } catch {
      if (live.current) setCheckMessage('No hemos podido comprobar el pago. No hemos iniciado otro; puedes volver a comprobarlo.');
    } finally { checking.current = false; if (live.current) setBusy(false); }
  };
  const actions = (failure || onCheckStatus) && <div className="bil-onboard-actions">
    {failure?.retryable && <button type="button" className="uon-profile-submit" disabled={busy || confirming} onClick={() => setAttempt(value => value + 1)}>Reintentar formulario</button>}
    {onCheckStatus && <button type="button" className="uon-onboard-back" disabled={busy || confirming} onClick={() => void checkStatus()}>{busy || confirming ? confirmed ? 'Confirmando…' : 'Comprobando…' : confirmed ? 'Continuar con Uony' : 'Comprobar mi pago'}</button>}
  </div>;
  return <section className="bil-embedded" aria-label="Pago seguro con Stripe" data-stripe-checkout-state={status} data-stripe-failure-category={failure?.code}>
    {status === 'loading' && <p role="status">{slow ? 'Stripe está tardando en responder. Puedes comprobar tu pago o cerrar el formulario y retomarlo.' : 'Preparando el formulario de pago seguro…'}</p>}
    {failure && <div role="alert"><p>{failure.message}</p><p>Reintentar este formulario no crea otra suscripción ni realiza un cobro.</p></div>}
    {!confirmed && actions}
    {checkMessage && <p role="status">{checkMessage}</p>}
    <div ref={host} className="bil-embedded-host" />
    {confirmed && actions}
  </section>;
}
