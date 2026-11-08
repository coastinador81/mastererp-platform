import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { GoogleBillingPanel } from '../components/composer/GoogleBillingPanel';
import { ContextUsage } from '../components/composer/ContextUsage';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useComposerStore } from '../hooks/composerStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useUiStore } from '../hooks/uiStore';
import type { GoogleBillingSnapshot } from '../api/googleBilling';

const identity = vi.hoisted(() => ({ account: 'billing@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ user: identity.account ? { email: identity.account } : null }) }));
const snapshot: GoogleBillingSnapshot = { status: 'available', accountEmail: 'billing@example.test',
  projectId: 'project-a', projectName: 'Uonify', billingAccountName: 'billingAccounts/ABC-DEF', currency: 'EUR',
  creditEUR: '230.74', consumptionEUR: '1.98', netConsumptionEUR: '0.00', consumptionScope: 'billing_account',
  periodStart: '2026-10-01', periodEnd: '2026-10-15', observedAt: '2026-10-15T09:20:30Z',
  recordedAt: '2026-10-15T09:21:40Z', checkedAt: '2026-10-16T10:00:00Z', creditExpiresAt: null, creditExpiresOn: '2027-01-05',
  source: { kind: 'observed_google_console', url: 'https://console.cloud.google.com/billing', live: false },
  reason: null, message: 'Datos registrados de Google.' };
const connected = (projectId = 'project-a', email = identity.account) => ({ connection: { status: 'connected', projectId, projectName: 'Uonify', email }, accessAllowed: true });
let client: QueryClient;
beforeEach(() => {
  identity.account = 'billing@example.test'; client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useComposerStore.setState({ draft: '', picker: null }); useWorkspaceStore.setState({ activeThreadId: null, threads: [] }); useUiStore.setState({ pendingReply: null });
  useGooglePreferences.setState({ account: identity.account, saving: false, data: { models: [{ id: 'gemini-3.5-flash', label: 'Gemini', short: 'Flash', detail: '', efforts: ['medium'] }], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });
const preview = (active = true) => render(<QueryClientProvider client={client}><GoogleBillingPanel active={active} /></QueryClientProvider>);
function mockData(data: GoogleBillingSnapshot = snapshot) {
  return vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : data) as never);
}
it('carga solo al abrir Google y muestra dinero observado con su fecha exacta sin usar la fecha del GET', async () => {
  const get = mockData(); const view = preview(false); expect(get).not.toHaveBeenCalled();
  view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>);
  await screen.findByText('230,74 €'); expect(screen.getByText('1,98 €')).toBeInTheDocument();
  expect(screen.getByText('1–15 de octubre de 2026')).toBeInTheDocument();
  const time = document.querySelector('time'); expect(time).toHaveAttribute('datetime', snapshot.observedAt);
  expect(time).toHaveTextContent('15/10/2026'); expect(time).not.toHaveTextContent('16/10/2026');
  const info = screen.getByRole('button', { name: 'Origen de estos datos' }); expect(info).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(info); expect(screen.getByText(/toda tu cuenta de facturación/)).toBeInTheDocument();
  expect(screen.getByText(/antes de aplicar créditos/)).toBeInTheDocument(); expect(screen.getByText(/0,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/no se sincroniza automáticamente/)).toBeInTheDocument();
  expect(screen.getByText('Vencimiento del crédito: 5 de enero de 2027.')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
});
it('desconocido no se presenta como cero y una fecha de consulta no acredita un saldo', async () => {
  mockData({ ...snapshot, status: 'unavailable', creditEUR: null, consumptionEUR: null, observedAt: null, recordedAt: null, source: null, message: 'No tenemos importes comprobados.' }); preview();
  await screen.findByText('No tenemos importes comprobados.');
  expect(screen.getByRole('status')).toHaveTextContent('No tenemos importes comprobados.');
  expect(screen.queryByRole('button', { name: 'Reintentar consulta' })).not.toBeInTheDocument();
  expect(screen.queryByText(/0,00/)).not.toBeInTheDocument(); expect(document.querySelector('time')).toBeNull();
});
it('sin observación ofrece la cuenta oficial vigente y distingue la fecha de conexión de una fecha monetaria', async () => {
  const credits = 'https://console.cloud.google.com/billing/ABC-DEF/credits?authuser=billing%40example.test&project=project-a';
  const reports = credits.replace('/credits?', '/reports?');
  const get = mockData({ ...snapshot, status: 'unavailable', creditEUR: null, consumptionEUR: null, observedAt: null,
    recordedAt: null, source: null, reason: 'not_observed', billingVerified: true, consoleLinks: { credits, reports },
    message: 'Tu facturación está conectada. El saldo no se sincroniza automáticamente.' });
  preview();
  expect(await screen.findByRole('link', { name: 'Consultar en Google ↗' })).toHaveAttribute('href', credits);
  expect(screen.queryByRole('button', { name: 'Reintentar consulta' })).not.toBeInTheDocument();
  expect(screen.getByText(/Conexión comprobada el/)).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', snapshot.checkedAt);
  expect(screen.queryByText(/Datos comprobados en Google el/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(2);
});
it.each([
  'https://malicioso.test/billing/ABC-DEF/credits?authuser=billing%40example.test&project=project-a',
  'https://console.cloud.google.com/billing/FOREIGN/credits?authuser=billing%40example.test&project=project-a',
  'https://console.cloud.google.com/billing/ABC-DEF/credits?authuser=foreign%40example.test&project=project-a',
])('descarta una acción de facturación sin cuenta y origen coincidentes: %s', async credits => {
  mockData({ ...snapshot, status: 'unavailable', observedAt: null, recordedAt: null, source: null,
    billingVerified: true, consoleLinks: { credits, reports: credits.replace('/credits?', '/reports?') } });
  preview(); await screen.findByText(snapshot.message);
  expect(screen.queryByRole('link', { name: /Consultar en Google/ })).not.toBeInTheDocument();
});
it('la cifra antigua se rotula como última comprobación y conserva su fecha al verificar metadatos', async () => {
  mockData({ ...snapshot, status: 'stale', reason: 'metadata_unavailable', checkedAt: '2027-01-01T10:00:00Z' }); preview();
  await screen.findByText('Último crédito comprobado'); expect(screen.getByText('230,74 €')).toBeInTheDocument();
  expect(screen.getByText(/pueden haber cambiado/)).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', snapshot.observedAt);
});
it('un error no filtra la cifra en caché ni reintenta solo, y el reintento no inventa una nueva fecha monetaria', async () => {
  let failed = true;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return connected() as never;
    if (failed) throw new Error('Error técnico privado'); return snapshot as never;
  }); preview();
  await screen.findByRole('button', { name: 'Reintentar consulta' });
  expect(screen.queryByText('230,74 €')).not.toBeInTheDocument(); expect(screen.queryByText('Error técnico privado')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2); failed = false; fireEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' }));
  await screen.findByText('230,74 €'); expect(document.querySelector('time')).toHaveAttribute('datetime', snapshot.observedAt);
});
it('un eco de cuenta o proyecto distinto nunca muestra sus importes', async () => {
  mockData({ ...snapshot, accountEmail: 'another@example.test', projectId: 'other-project' }); preview();
  await screen.findByRole('button', { name: 'Reintentar consulta' }); expect(screen.queryByText('230,74 €')).not.toBeInTheDocument();
});
it('cambiar de proyecto separa la caché y descarta una respuesta tardía del proyecto anterior', async () => {
  let oldResolve: ((value: GoogleBillingSnapshot) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementationOnce(async () => connected() as never)
    .mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }))
    .mockResolvedValueOnce({ ...snapshot, projectId: 'project-b', creditEUR: '100.50' });
  preview(); await waitFor(() => expect(oldResolve).toBeDefined());
  act(() => client.setQueryData(['google-cloud', identity.account], connected('project-b')));
  await screen.findByText('100,50 €'); await act(async () => { oldResolve?.(snapshot); });
  expect(screen.queryByText('230,74 €')).not.toBeInTheDocument(); expect(screen.getByText('100,50 €')).toBeInTheDocument();
});
it('cambiar de cuenta elimina los importes anteriores y requiere la conexión propia', async () => {
  const get = mockData(); const view = preview(); await screen.findByText('230,74 €');
  identity.account = 'next@example.test'; get.mockImplementation(async path => (path === '/connections/google-cloud' ? connected() : { ...snapshot, accountEmail: identity.account, creditEUR: '80.00' }) as never);
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>);
  expect(screen.queryByText('230,74 €')).not.toBeInTheDocument(); await screen.findByText('80,00 €');
  expect(client.getQueryCache().findAll({ queryKey: ['uony-google-billing', 'billing@example.test'] })).toHaveLength(0);
});
it('reabrir Google comprueba de nuevo la asociación aunque no hayan cambiado la cuenta ni el proyecto', async () => {
  let changed = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => (path === '/connections/google-cloud' ? connected()
    : changed ? { ...snapshot, status: 'unavailable', creditEUR: null, consumptionEUR: null, observedAt: null, recordedAt: null, source: null, message: 'No hay datos para la cuenta de facturación actual.' } : snapshot) as never);
  const view = preview(); await screen.findByText('230,74 €');
  view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active={false} /></QueryClientProvider>);
  changed = true; view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>);
  expect(screen.queryByText('230,74 €')).not.toBeInTheDocument();
  await screen.findByText('No hay datos para la cuenta de facturación actual.');
  expect(screen.queryByText('230,74 €')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(4);
});
it('una conexión no verificable al reabrir impide presentar el saldo previo como disponible', async () => {
  let failed = false;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') { if (failed) throw new Error('Error de metadatos'); return connected() as never; }
    return snapshot as never;
  });
  const view = preview(); await screen.findByText('230,74 €');
  view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active={false} /></QueryClientProvider>);
  failed = true; view.rerender(<QueryClientProvider client={client}><GoogleBillingPanel active /></QueryClientProvider>);
  await screen.findByText('No podemos comprobar tu conexión con Google ahora.'); expect(screen.queryByText('230,74 €')).not.toBeInTheDocument();
});
it('las pestañas funcionan con teclado, mantienen el mismo panel y cierran devolviendo el foco al círculo', async () => {
  function Usage() { const form = useRef<HTMLFormElement>(null); return <form ref={form}><ContextUsage formRef={form} /></form>; }
  mockData(); vi.spyOn(api, 'post').mockResolvedValue({ status: 'measured', model: 'gemini-3.5-flash', modelLabel: 'Gemini', usedTokens: 100, limitTokens: 1000, remainingTokens: 900, usageRatio: 0.1, measurement: 'google_count_tokens', measuredAt: '', historyTurns: 0, historyLimit: 12 });
  render(<QueryClientProvider client={client}><Usage /></QueryClientProvider>);
  const trigger = screen.getByRole('button', { name: /^Contexto de esta conversación:/ }); fireEvent.click(trigger);
  const context = screen.getByRole('tab', { name: 'Contexto' }); const google = screen.getByRole('tab', { name: 'Google' });
  context.focus(); fireEvent.keyDown(context, { key: 'ArrowRight' }); expect(google).toHaveFocus(); expect(google).toHaveAttribute('aria-selected', 'true');
  const panel = screen.getByRole('region', { name: 'Contexto y Google' }); await within(panel).findByText('230,74 €');
  expect(screen.getByRole('tabpanel', { name: 'Google' })).toHaveClass('composer-usage-tabpanel');
  fireEvent.keyDown(google, { key: 'Home' }); expect(context).toHaveFocus(); expect(context).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Contexto' })).toHaveClass('composer-usage-tabpanel');
  fireEvent.keyDown(context, { key: 'Escape' }); expect(panel).toHaveAttribute('hidden'); expect(trigger).toHaveFocus();
});
