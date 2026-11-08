import { StrictMode, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { GoogleBillingPanel } from '../components/composer/GoogleBillingPanel';
import { ContextUsage } from '../components/composer/ContextUsage';
import type { GoogleBillingSnapshot, GoogleBillingSync } from '../api/googleBilling';
import { GOOGLE_REPORT_DOCUMENTATION, googleReportPeriod, verifiedGoogleCredit, verifiedGoogleSnapshot } from '../model/googleBilling';

const identity = vi.hoisted(() => ({ account: 'billing@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ user: identity.account ? { email: identity.account } : null }) }));
const source = { kind: 'google_app_optimize', url: GOOGLE_REPORT_DOCUMENTATION, live: true,
  scope: 'project', costBasis: 'gross_before_credits' } as const;
function syncState(changes: Partial<GoogleBillingSync> = {}): GoogleBillingSync {
  return { status: 'ready', projectId: 'project-a', billingAccountName: 'billingAccounts/ABC-DEF',
    canSync: false, nextCheckAt: '2099-01-01T00:00:00Z', checkedAt: '2026-10-15T20:30:00Z',
    periodStart: '2026-10-01T07:00:00Z', periodEnd: '2026-10-15T20:00:00Z', consumptionEUR: '1.98', currency: 'EUR',
    source, reason: null, message: 'Coste bruto del proyecto obtenido de Google.', ...changes };
}
function empty(changes: Partial<GoogleBillingSnapshot> = {}): GoogleBillingSnapshot {
  const credits = 'https://console.cloud.google.com/billing/ABC-DEF/credits?authuser=billing%40example.test&project=project-a';
  return { status: 'unavailable', accountEmail: 'billing@example.test', projectId: 'project-a', projectName: 'Uonify',
    billingAccountName: 'billingAccounts/ABC-DEF', currency: null, creditEUR: null, consumptionEUR: null,
    consumptionScope: 'billing_account', periodStart: null, periodEnd: null, observedAt: null, recordedAt: null,
    checkedAt: '2026-10-15T20:30:00Z', creditExpiresAt: null, source: null, reason: 'not_observed',
    message: 'La facturación está conectada.', billingVerified: true,
    consoleLinks: { credits, reports: credits.replace('/credits?', '/reports?') }, sync: null, ...changes };
}
function ready(changes: Partial<GoogleBillingSnapshot> = {}): GoogleBillingSnapshot {
  const sync = syncState();
  return empty({ status: 'available', currency: 'EUR', consumptionEUR: sync.consumptionEUR, consumptionScope: 'project',
    periodStart: sync.periodStart, periodEnd: sync.periodEnd, source, sync,
    observedAt: sync.checkedAt, recordedAt: sync.checkedAt, reason: null, ...changes });
}
const connected = (projectId = 'project-a') => ({ connection: { status: 'connected', projectId, projectName: 'Uonify', email: identity.account }, accessAllowed: true });
let client: QueryClient;
beforeEach(() => {
  identity.account = 'billing@example.test';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
function preview(strict = false) {
  const panel = <QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>;
  return render(strict ? <StrictMode>{panel}</StrictMode> : panel);
}
function wrapper(data: GoogleBillingSnapshot) {
  return { accountEmail: data.accountEmail, projectId: data.projectId,
    billingAccountName: data.billingAccountName, sync: data.sync };
}

it('continúa al abrir una sola vez también en StrictMode, muestra consumo del proyecto y no inventa saldo', async () => {
  let data = empty();
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { data = ready(); return wrapper(data) as never; });
  preview(true);
  await screen.findByText('1,98 €');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toBe('/uony/google-billing/sync');
  expect(post.mock.calls[0][1]).toEqual({ prepare: false });
  expect(screen.getByText('Consumo del proyecto')).toBeInTheDocument();
  expect(screen.getByText('Sin datos')).toBeInTheDocument();
  expect(screen.queryByText('0,00 €')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Origen de estos datos' }));
  expect(screen.getByText(/más de 24 horas/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Cómo publica Google/ })).toHaveAttribute('href', GOOGLE_REPORT_DOCUMENTATION);
  expect(screen.getByRole('link', { name: /Consultar el crédito/ })).toHaveAttribute('href', data.consoleLinks!.credits);
});

it('activar la consulta requiere el botón explícito y nunca se activa al abrir o con doble clic', async () => {
  let data = empty({ sync: syncState({ status: 'needs_setup', consumptionEUR: null, source: null, canSync: true,
    reason: 'service_disabled', nextCheckAt: null, message: 'Activa la consulta de consumo.' }) });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  let finish: (() => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => {
    finish = () => { data = ready(); resolve(wrapper(data)); };
  }));
  preview();
  const button = await screen.findByRole('button', { name: 'Activar consulta' });
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(button); fireEvent.click(button);
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][1]).toEqual({ prepare: true });
  await act(async () => finish?.());
  await screen.findByText('1,98 €');
});

it('deshabilitar el botón enfocado no cierra el panel de uso ni aborta la activación', async () => {
  function Usage() {
    const form = useRef<HTMLFormElement>(null);
    return <><form ref={form}><ContextUsage formRef={form} /></form><button type="button">Fuera del panel</button></>;
  }
  let data = empty({ sync: syncState({ status: 'needs_setup', consumptionEUR: null, source: null, canSync: true,
    reason: 'service_disabled', nextCheckAt: null, message: 'Activa la consulta de consumo.' }) });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  let finish: (() => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => {
    finish = () => { data = ready(); resolve(wrapper(data)); };
  }));
  render(<QueryClientProvider client={client}><Usage /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Contexto de esta conversación:/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Google' }));
  const button = await screen.findByRole('button', { name: 'Activar consulta' });
  button.focus(); fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled());
  fireEvent.blur(button, { relatedTarget: null });
  const panel = screen.getByRole('region', { name: 'Contexto y Google' });
  expect(panel).not.toHaveAttribute('hidden');
  expect(post.mock.calls[0][2]?.signal?.aborted).toBe(false);
  await act(async () => finish?.()); await screen.findByText('1,98 €');
  expect(panel).not.toHaveAttribute('hidden');
  fireEvent.blur(panel, { relatedTarget: screen.getByRole('button', { name: 'Fuera del panel' }) });
  expect(panel).toHaveAttribute('hidden');
});

it('un error guardado no reintenta solo y permite revisar explícitamente el mismo consumo', async () => {
  let data = empty({ sync: syncState({ status: 'error', canSync: true, source: null, reason: 'permission_denied', nextCheckAt: null,
    message: 'Google no permite consultar estos costes con los permisos actuales.' }) });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { data = ready(); return wrapper(data) as never; });
  preview();
  const button = await screen.findByRole('button', { name: 'Actualizar consumo' });
  expect(post).not.toHaveBeenCalled(); fireEvent.click(button);
  await screen.findByText('1,98 €'); expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ prepare: false });
});

it('una habilitación incierta solicita preparar solo desde el botón y conserva el aviso', async () => {
  const data = empty({ sync: syncState({ status: 'error', canSync: true, source: null, reason: 'service_unconfirmed', nextCheckAt: null,
    message: 'Google aún no confirma la activación de la consulta.' }) });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue(wrapper(data));
  preview();
  const button = await screen.findByRole('button', { name: 'Activar consulta' });
  expect(post).not.toHaveBeenCalled(); fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post.mock.calls[0][1]).toEqual({ prepare: true });
});

it('espera a nextCheckAt y refresca primero el estado antes de continuar el informe pendiente', async () => {
  const due = Date.now() + 80;
  let data = empty({ sync: syncState({ status: 'pending', canSync: false, nextCheckAt: new Date(due).toISOString(),
    source: null, consumptionEUR: null, message: 'Google está preparando la consulta de consumo.' }) });
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return connected() as never;
    if (data.sync?.status === 'pending' && Date.now() >= due) data = { ...data, sync: { ...data.sync, canSync: true } };
    return data as never;
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { data = ready(); return wrapper(data) as never; });
  preview(); await screen.findByText('Google está preparando la consulta de consumo.');
  expect(post).not.toHaveBeenCalled();
  await screen.findByText('1,98 €', {}, { timeout: 3000 });
  expect(get.mock.calls.filter(([path]) => path === '/uony/google-billing').length).toBeGreaterThanOrEqual(3);
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['ready', 'no_records'] as const)('renueva %s al vencer su caché con el panel abierto', async status => {
  vi.useFakeTimers();
  const now = Date.now();
  const due = now + 6 * 60 * 60 * 1000;
  let data = status === 'ready' ? ready() : empty();
  data = { ...data, sync: syncState({ status, canSync: false, nextCheckAt: new Date(due).toISOString(),
    ...(status === 'no_records' ? { consumptionEUR: null, currency: null } : {}) }) };
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return connected() as never;
    if (Date.now() >= due && data.sync?.nextCheckAt === new Date(due).toISOString()) {
      data = { ...data, sync: { ...data.sync, canSync: true } };
    }
    return data as never;
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { data = ready(); return wrapper(data) as never; });
  preview();
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Actualizar consumo' })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ prepare: false });
  expect(get.mock.calls.filter(([path]) => path === '/uony/google-billing').length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText('1,98 €')).toBeInTheDocument();
});

it('un fallo de red se detiene y no publica mensajes técnicos ni vuelve a crear operaciones solo', async () => {
  let data = empty();
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('private provider error'))
    .mockImplementation(async () => { data = ready(); return wrapper(data) as never; });
  preview();
  const button = await screen.findByRole('button', { name: 'Reintentar consulta' });
  expect(screen.getByRole('status')).toHaveTextContent('No hemos podido actualizar el consumo');
  expect(screen.queryByText('private provider error')).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1); fireEvent.click(button);
  await screen.findByText('1,98 €'); expect(post).toHaveBeenCalledTimes(2);
});

it('un bloqueo concurrente relee el servidor sin repetir la preparación', async () => {
  let data = empty({ sync: syncState({ status: 'needs_setup', canSync: true, nextCheckAt: null, source: null,
    reason: 'service_disabled', message: 'Activa la consulta de consumo.' }) });
  const get = vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    data = empty({ sync: syncState({ status: 'pending', canSync: false, source: null, nextCheckAt: '2099-01-01T00:00:00Z',
      message: 'Google está preparando la consulta de consumo.' }) });
    throw new ApiError(409, { error: 'billing_sync_busy' });
  });
  preview(); fireEvent.click(await screen.findByRole('button', { name: 'Activar consulta' }));
  await screen.findByText('Google está preparando la consulta de consumo.');
  expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(3);
});

it('conserva la fecha propia de un crédito manual al actualizar el consumo automático', async () => {
  const data = ready({ creditEUR: '230.74', creditObservedAt: '2026-10-05T09:20:30Z', creditStale: true,
    creditSource: { kind: 'observed_google_console', url: 'https://console.cloud.google.com/billing/ABC-DEF/credits', live: false } });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post'); preview();
  await screen.findByText('230,74 €'); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText('Último crédito comprobado')).toBeInTheDocument();
  const times = [...document.querySelectorAll('time')];
  expect(times.map(time => time.dateTime)).toEqual([data.observedAt, data.creditObservedAt]);
  fireEvent.click(screen.getByRole('button', { name: 'Origen de estos datos' }));
  expect(screen.getByText(/conserva su propia fecha/)).toBeInTheDocument();
});

it('al cambiar de cuenta aborta la petición y nunca muestra la respuesta tardía anterior', async () => {
  let data = empty(); let finish: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected()
    : identity.account === data.accountEmail ? data : { ...empty(), accountEmail: identity.account, sync: undefined }) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = preview(); await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const signal = post.mock.calls[0][2]?.signal;
  identity.account = 'next@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>);
  expect(signal?.aborted).toBe(true);
  data = ready(); await act(async () => finish?.(wrapper(data)));
  expect(screen.queryByText('1,98 €')).not.toBeInTheDocument();
});

it('descarta un eco de proyecto distinto y evita convertirlo en el consumo actual', async () => {
  const data = empty();
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ...wrapper(ready()), projectId: 'foreign-project' });
  preview(); await screen.findByText(/No hemos podido actualizar el consumo/);
  expect(post).toHaveBeenCalledTimes(1); expect(screen.queryByText('1,98 €')).not.toBeInTheDocument();
});

it('filas no publicadas siguen sin importe y no provocan bucles de consulta', async () => {
  const data = empty({ sync: syncState({ status: 'no_records', consumptionEUR: null, currency: null,
    message: 'Google todavía no ha publicado registros para este periodo. No significa que el consumo sea cero.' }) });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post'); preview();
  await screen.findByText(/No significa que el consumo sea cero/);
  expect(post).not.toHaveBeenCalled(); expect(screen.queryByText('0,00 €')).not.toBeInTheDocument();
  expect(screen.getByText('1–15 de octubre de 2026 · hora de Google')).toBeInTheDocument();
  expect(screen.getByText(/Consulta de consumo comprobada el/)).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', data.sync!.checkedAt);
  expect(screen.queryByText(/Conexión comprobada el/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Origen de estos datos' }));
  expect(screen.getByText(/más de 24 horas/)).toBeInTheDocument();
});

it('un 409 ajeno al bloqueo de sincronización no se confunde con una consulta pendiente', async () => {
  const data = empty();
  const get = vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { error: 'connection_changed' }));
  preview(); await screen.findByText(/No hemos podido actualizar el consumo/);
  expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(2);
});

it('valida la fuente automática, la moneda y la independencia del crédito observado', () => {
  const data = ready();
  expect(verifiedGoogleSnapshot(data)).toBe(data);
  expect(verifiedGoogleSnapshot({ ...data, currency: null })).toBeNull();
  expect(verifiedGoogleSnapshot({ ...data, source: { ...source, url: 'https://example.test' } })).toBeNull();
  expect(verifiedGoogleCredit({ ...data, creditEUR: '230.74' })).toBeNull();
  expect(googleReportPeriod(data.periodStart, data.periodEnd)).toBe('1–15 de octubre de 2026 · hora de Google');
  expect(googleReportPeriod(data.periodEnd, data.periodStart)).toBeNull();
});
