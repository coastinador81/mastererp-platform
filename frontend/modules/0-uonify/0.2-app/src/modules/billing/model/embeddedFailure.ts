import { stripeErrorMessage } from './embeddedDiagnostic';

export type CheckoutPhase = 'configuration' | 'script' | 'initialization' | 'mount';
export type CheckoutFailureCode = 'configuration' | 'connection' | 'expired' | 'completed' | 'integration' | 'initialization' | 'mount';

/** Nunca devuelve mensajes del SDK: pueden contener claves o el secreto de sesión. */
export function embeddedFailure(error: unknown, phase: CheckoutPhase): { code: CheckoutFailureCode; message: string; retryable: boolean } {
  const detail = stripeErrorMessage(error);
  if (phase === 'configuration') return { code: 'configuration', message: 'El pago seguro necesita una revisión de configuración. Tu modalidad sigue guardada.', retryable: false };
  if (/expir(?:ed|ation)|session.*no longer (?:open|active)/i.test(detail)) {
    return { code: 'expired', message: 'Stripe indica que este formulario ha caducado. Comprueba el estado del pago antes de retomarlo.', retryable: false };
  }
  if (/already (?:complete|completed)|session.*(?:complete|completed)/i.test(detail)) {
    return { code: 'completed', message: 'Stripe indica que este pago ya terminó. Comprueba su estado para continuar.', retryable: false };
  }
  if (/api.?key|publishable|invalid.*(?:client.?secret|secret)|no such.*(?:session|payment.?page)|multiple.*embedded|has been removed|embedded checkout method is not available/i.test(detail)) {
    return { code: 'integration', message: 'Stripe no ha podido validar este formulario. Tu modalidad sigue guardada; comprueba el estado del pago para retomarlo.', retryable: false };
  }
  if (phase === 'script' || /network|failed to fetch|failed to load|loaderror|connection|timed? ?out/i.test(detail)) {
    return { code: 'connection', message: 'No hemos podido conectar con el formulario de Stripe. Comprueba tu conexión y que el navegador permita cargar Stripe.', retryable: true };
  }
  return { code: phase === 'mount' ? 'mount' : 'initialization', message: 'No hemos podido abrir el formulario de Stripe. Puedes reintentar el mismo pago sin crear otro.', retryable: true };
}
