import { render, screen, waitFor } from '@testing-library/react';
import { api } from '@/shared/api/client';
import { EmbeddedCheckout } from '../components/EmbeddedCheckout';
import { stripeDiagnostic, stripeErrorMessage } from '../model/embeddedDiagnostic';
import { embeddedFailure } from '../model/embeddedFailure';
import { reportStripeFailure } from '../api/embeddedDiagnostics';

const sdk = vi.hoisted(() => ({ load: vi.fn(), init: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: sdk.load }));
const session = {
  checkoutAttemptId: '8942ad8e-9d31-4bb6-a993-07938c11eb15',
  clientSecret: 'opaque-fixture-secret-only', publishableKey: 'pk_test_FixtureOnly000000000000',
  summary: { currency: 'EUR' as const, interval: 'annual' as const, baseCents: 11880, taxCents: 2495, totalCents: 14375, dueTodayCents: 14375, trialDays: 0, reminderDays: 3, taxScope: 'sandbox_fixed_21' },
};
afterEach(() => { vi.restoreAllMocks(); });

it('conserva los mensajes de errores de otro contexto y de objetos de Stripe', () => {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const ForeignError = Reflect.get(frame.contentWindow!, 'Error') as typeof Error;
  const foreign: unknown = new ForeignError('Checkout session expired');
  expect(foreign instanceof Error).toBe(false);
  expect(embeddedFailure(foreign, 'initialization').code).toBe('expired');
  frame.remove();
  expect(embeddedFailure({ error: { message: 'Invalid client_secret' } }, 'initialization').code).toBe('integration');
  expect(embeddedFailure('Failed to fetch', 'initialization').code).toBe('connection');
});

it('no ejecuta serializadores arbitrarios ni falla si un objeto rechaza sus propiedades', () => {
  const serialize = vi.fn(() => { throw new Error('never'); });
  expect(stripeErrorMessage({ toString: serialize, toJSON: serialize })).toBe('');
  const value = Object.create(null, { message: { get() { throw new Error('denied'); } } });
  expect(stripeDiagnostic(value, []).message).toBe('');
  expect(serialize).not.toHaveBeenCalled();
});

it('elimina secretos conocidos, claves, URL, correo, tarjetas y tokens opacos sin publicar el SDK', () => {
  const error = new Error(`Failed ${session.clientSecret} ${session.publishableKey} sk_test_fixtureSecretValue client_secret=another-secret token:unsafe user@example.test https://stripe.test/secret?id=private 4242 4242 4242 4242 abcdef1234567890abcdef1234567890`);
  const detail = stripeDiagnostic(error, [session.clientSecret, session.publishableKey]);
  for (const forbidden of [session.clientSecret, session.publishableKey, 'sk_test_', 'another-secret', 'unsafe', 'user@', 'https:', '4242', 'abcdef123']) expect(detail.message).not.toContain(forbidden);
  expect(detail.message).toContain('Failed');
  expect(detail.message.length).toBeLessThanOrEqual(1200);
  expect(embeddedFailure(error, 'mount').message).not.toContain('user@');
});

it.each([
  'Cookie: session=short-secret; user=person', 'Authorization: Basic c2hvcnQ=',
  'client secret: short-value', 'api key: short-value', '"access_token":"short-value"',
  'https://sdk.test/token/short-value',
])('redacta también encabezados y etiquetas variantes: %s', message => {
  const detail = stripeDiagnostic(new Error(message), []);
  for (const value of ['short-secret', 'person', 'c2hvcnQ=', 'short-value', 'https://']) expect(detail.message).not.toContain(value);
});

it('registra el fallo de inicialización sin llamar a cobros ni conceder acceso, aunque falle el diagnóstico', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('diagnostic offline'));
  sdk.load.mockResolvedValue({ initEmbeddedCheckout: sdk.init });
  sdk.init.mockRejectedValue({ message: `Unexpected SDK error: ${session.clientSecret}` });
  const complete = vi.fn();
  render(<EmbeddedCheckout session={session} onComplete={complete} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido abrir');
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith('/billing/checkout-diagnostics', expect.objectContaining({ checkoutAttemptId: session.checkoutAttemptId, phase: 'initialization', category: 'initialization', errorName: 'Object' }), expect.any(Object));
  expect(JSON.stringify(post.mock.calls)).not.toContain(session.clientSecret);
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reintentar formulario' })).toBeEnabled();
});

it('conserva un diagnóstico sin mensaje utilizable con un marcador fijo', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ recorded: true });
  reportStripeFailure(session.checkoutAttemptId, 'mount', 'mount', {}, []);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/billing/checkout-diagnostics', expect.objectContaining({ errorName: 'Object', message: '[No message]' }), expect.any(Object)));
});
