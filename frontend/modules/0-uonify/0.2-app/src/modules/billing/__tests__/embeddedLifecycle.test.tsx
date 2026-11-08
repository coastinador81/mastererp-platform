import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StripeEmbeddedCheckoutOptions } from '@stripe/stripe-js';
import { EmbeddedCheckout } from '../components/EmbeddedCheckout';
import type { EmbeddedCheckoutSession } from '../model/onboarding';
import { embeddedFailure } from '../model/embeddedFailure';

const sdk = vi.hoisted(() => ({ load: vi.fn(), init: vi.fn(), mount: vi.fn(), destroy: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: sdk.load }));
const session: EmbeddedCheckoutSession = {
  clientSecret: 'opaque-fixture-never-real', publishableKey: 'pk_test_FixtureOnly000000000000',
  summary: { currency: 'EUR', interval: 'annual', baseCents: 11880, taxCents: 2495, totalCents: 14375, dueTodayCents: 14375, trialDays: 0, reminderDays: 3, taxScope: 'sandbox_fixed_21' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  sdk.load.mockReset(); sdk.init.mockReset(); sdk.mount.mockReset(); sdk.destroy.mockReset();
  sdk.load.mockResolvedValue({ initEmbeddedCheckout: sdk.init });
  sdk.init.mockResolvedValue({ mount: sdk.mount, destroy: sdk.destroy });
});
afterEach(() => { vi.useRealTimers(); });

it('reintenta una carga fallida con el mismo secreto y sin llamar a la confirmación', async () => {
  const complete = vi.fn(); const check = vi.fn(async () => false);
  sdk.load.mockRejectedValueOnce(new Error('Failed to load Stripe.js'));
  render(<EmbeddedCheckout session={session} onComplete={complete} onCheckStatus={check} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido conectar');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar formulario' }));
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  expect(sdk.load).toHaveBeenCalledTimes(2);
  expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: session.clientSecret }));
  expect(check).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('StrictMode no inicia dos formularios cuando la carga termina después de limpiar el primer efecto', async () => {
  const loading = deferred<{ initEmbeddedCheckout: typeof sdk.init }>();
  sdk.load.mockReturnValue(loading.promise);
  const view = render(<StrictMode><EmbeddedCheckout session={session} onComplete={vi.fn()} /></StrictMode>);
  await act(async () => { loading.resolve({ initEmbeddedCheckout: sdk.init }); });
  expect(sdk.init).toHaveBeenCalledTimes(1); expect(sdk.mount).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
});

it('destruye una inicialización tardía al salir y no admite callbacks de una cuenta anterior', async () => {
  const pending = deferred<{ mount: typeof sdk.mount; destroy: typeof sdk.destroy }>();
  const complete = vi.fn(); sdk.init.mockReturnValue(pending.promise);
  const view = render(<EmbeddedCheckout session={session} onComplete={complete} />);
  await waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  const options = sdk.init.mock.calls[0][0] as StripeEmbeddedCheckoutOptions;
  view.unmount();
  await act(async () => { pending.resolve({ mount: sdk.mount, destroy: sdk.destroy }); });
  options.onComplete?.();
  expect(sdk.mount).not.toHaveBeenCalled(); expect(sdk.destroy).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled();
});

it('espera a destruir un init pendiente antes de abrir el formulario de otra cuenta', async () => {
  const pending = deferred<{ mount: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>();
  const staleMount = vi.fn(); const staleComplete = vi.fn(); const currentComplete = vi.fn();
  let occupied = false;
  const staleDestroy = vi.fn(() => { occupied = false; });
  sdk.init.mockImplementation(() => {
    if (occupied) throw new Error('You cannot have multiple Embedded Checkout objects');
    occupied = true;
    return sdk.init.mock.calls.length === 1 ? pending.promise : Promise.resolve({ mount: sdk.mount, destroy: sdk.destroy });
  });
  const first = render(<EmbeddedCheckout session={session} onComplete={staleComplete} />);
  await waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  const oldOptions = sdk.init.mock.calls[0][0] as StripeEmbeddedCheckoutOptions;
  first.unmount();
  const second = render(<EmbeddedCheckout session={{ ...session, clientSecret: 'another-account-fixture' }} onComplete={currentComplete} />);
  await act(async () => { await Promise.resolve(); });
  expect(sdk.init).toHaveBeenCalledTimes(1); expect(sdk.load).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ mount: staleMount, destroy: staleDestroy }); });
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  expect(staleMount).not.toHaveBeenCalled(); expect(staleDestroy).toHaveBeenCalledTimes(1);
  expect(sdk.init).toHaveBeenCalledTimes(2); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(() => { oldOptions.onComplete?.(); });
  expect(staleComplete).not.toHaveBeenCalled(); expect(currentComplete).not.toHaveBeenCalled();
  second.unmount(); expect(sdk.destroy).toHaveBeenCalledTimes(1);
});

it('un init anterior rechazado libera la cola sin bloquear el reingreso ni mostrar su error', async () => {
  const pending = deferred<never>(); sdk.init.mockReturnValueOnce(pending.promise);
  const first = render(<EmbeddedCheckout session={session} onComplete={vi.fn()} />);
  await waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  first.unmount();
  render(<EmbeddedCheckout session={session} onComplete={vi.fn()} />);
  await act(async () => { await Promise.resolve(); });
  expect(sdk.init).toHaveBeenCalledTimes(1);
  await act(async () => { pending.reject(new Error('Obsolete connection failure')); });
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  expect(sdk.init).toHaveBeenCalledTimes(2); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('recibir otra copia de la misma sesión no destruye el iframe ni inicia otro formulario', async () => {
  const original = vi.fn(); const updated = vi.fn();
  const view = render(<EmbeddedCheckout session={session} onComplete={original} />);
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  const options = sdk.init.mock.calls[0][0] as StripeEmbeddedCheckoutOptions;
  view.rerender(<EmbeddedCheckout session={{ ...session, summary: { ...session.summary } }} onComplete={updated} />);
  expect(sdk.init).toHaveBeenCalledTimes(1); expect(sdk.destroy).not.toHaveBeenCalled();
  act(() => { options.onComplete?.(); options.onComplete?.(); });
  expect(original).not.toHaveBeenCalled(); expect(updated).toHaveBeenCalledTimes(1);
});

it('limpia un montaje fallido una sola vez y permite montar una instancia nueva', async () => {
  sdk.mount.mockImplementationOnce(() => { throw new Error('Fixture mount failure'); });
  const view = render(<EmbeddedCheckout session={session} onComplete={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido abrir');
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar formulario' }));
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(2));
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
  view.unmount(); expect(sdk.destroy).toHaveBeenCalledTimes(2);
});

it('comprobar un pago pendiente no reinicia Stripe y las comprobaciones simultáneas se agrupan', async () => {
  const pending = deferred<boolean>(); const check = vi.fn(() => pending.promise);
  render(<EmbeddedCheckout session={session} onComplete={vi.fn()} onCheckStatus={check} />);
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  await userEvent.dblClick(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(check).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Comprobando…' })).toBeDisabled();
  await act(async () => { pending.resolve(false); });
  expect(sdk.init).toHaveBeenCalledTimes(1); expect(sdk.destroy).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Comprobar mi pago' })).toBeEnabled();
});

it('si Stripe tarda, informa y permite comprobar sin iniciar otra carga ni otro pago', async () => {
  vi.useFakeTimers(); const loading = deferred<never>(); sdk.load.mockReturnValue(loading.promise);
  render(<EmbeddedCheckout session={session} onComplete={vi.fn()} onCheckStatus={vi.fn(async () => false)} />);
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(screen.getByRole('status')).toHaveTextContent('Stripe está tardando en responder');
  expect(screen.getByRole('button', { name: 'Comprobar mi pago' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Reintentar formulario' })).not.toBeInTheDocument();
  expect(sdk.load).toHaveBeenCalledTimes(1); expect(sdk.init).not.toHaveBeenCalled();
});

it('una sesión caducada ofrece conciliación, sin repetir el secreto que rechazó Stripe', async () => {
  sdk.init.mockRejectedValueOnce(new Error('Checkout session expired: opaque-fixture-never-real'));
  render(<EmbeddedCheckout session={session} onComplete={vi.fn()} onCheckStatus={vi.fn(async () => false)} />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('ha caducado'); expect(alert).not.toHaveTextContent(session.clientSecret);
  expect(screen.queryByRole('button', { name: 'Reintentar formulario' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comprobar mi pago' })).toBeEnabled();
});

it('un error al comprobar no concede acceso ni deja bloqueada la recuperación', async () => {
  render(<EmbeddedCheckout session={session} onComplete={vi.fn()} onCheckStatus={vi.fn(async () => { throw new Error(session.clientSecret); })} />);
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(await screen.findByText(/No hemos podido comprobar el pago/)).not.toHaveTextContent(session.clientSecret);
  expect(screen.getByRole('button', { name: 'Comprobar mi pago' })).toBeEnabled();
  expect(sdk.init).toHaveBeenCalledTimes(1);
});

it.each([
  ['Invalid API key provided: pk_test_fixture', 'integration'],
  ['No such payment_page: opaque-fixture-never-real', 'integration'],
  ['Checkout session is already completed', 'completed'],
  ['Network connection unavailable', 'connection'],
] as const)('clasifica el error %s sin publicar datos del SDK', (detail, code) => {
  const result = embeddedFailure(new Error(detail), 'initialization');
  expect(result.code).toBe(code); expect(result.message).not.toContain(detail);
});

it('un rechazo de la clave al construir Stripe se distingue de una caída de conexión', () => {
  expect(embeddedFailure(new Error('Invalid API key provided: opaque-fixture'), 'script').code).toBe('integration');
});
