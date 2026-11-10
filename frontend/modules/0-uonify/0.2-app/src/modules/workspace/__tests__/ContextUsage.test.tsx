import { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ContextUsage } from '../components/composer/ContextUsage';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useUiStore, workspaceRefs } from '../hooks/uiStore';
import { setActiveProduct, type PimProduct } from '@/shared/pim';
import type { ContextMeasurement } from '../api/contextUsage';

const identity = vi.hoisted(() => ({ account: 'context@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ user: identity.account ? { email: identity.account } : null }) }));
function Preview() {
  const form = useRef<HTMLFormElement>(null);
  return <form ref={form}><input aria-label="Borrador" /><div className="composer-bottom-actions"><ContextUsage formRef={form} />
    <button type="button" aria-label="Rayo">ϟ</button></div></form>;
}
const measurement = (usedTokens = 250): ContextMeasurement => ({ status: 'measured', model: 'gemini-3.5-flash',
  modelLabel: 'Gemini 3.5 Flash', usedTokens, limitTokens: 1000, remainingTokens: Math.max(0, 1000 - usedTokens),
  usageRatio: usedTokens / 1000, measuredAt: '2026-10-15T12:00:00Z', historyTurns: 2, historyLimit: 12, measurement: 'google_count_tokens' });
function select(model = 'auto', effort: 'low' | 'medium' | 'high' = 'medium') {
  useGooglePreferences.setState({ account: identity.account, saving: false,
    data: { models: [{ id: 'gemini-3.5-flash', label: 'Gemini', short: 'Flash', detail: '', efforts: ['low', 'medium', 'high'] }],
      efforts: [], preferences: { model, effort }, autoPolicy: '' } });
}
let client: QueryClient;
beforeEach(() => {
  identity.account = 'context@example.test';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useComposerStore.setState({ draft: '', picker: null });
  useWorkspaceStore.setState({ activeThreadId: 'thread-a', threads: [{ id: 'thread-a', title: 'Producto', service: null, view: 'default', messages: [] }] });
  useUiStore.setState({ pendingReply: null });
  setActiveProduct(null); select();
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });
const preview = () => render(<QueryClientProvider client={client}><Preview /></QueryClientProvider>);
const trigger = () => screen.getByRole('button', { name: /^Contexto de esta conversación:/ });

it('presenta el círculo a la izquierda del rayo, mide sin enviar un mensaje y abre la información junto al compositor', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement()); preview();
  expect(trigger()).toHaveAccessibleName(/midiendo/);
  expect(trigger().nextElementSibling).toHaveAttribute('role', 'region');
  await screen.findByRole('button', { name: 'Contexto de esta conversación: 25 % ocupado' });
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/uony/context', { threadId: 'thread-a', text: '', model: 'auto', effort: 'medium', projectId: null, productContext: null }, { signal: expect.any(AbortSignal) });
  expect(trigger().parentElement?.lastElementChild).toHaveAccessibleName('Rayo');
  trigger().focus(); fireEvent.click(trigger());
  const panel = screen.getByRole('region', { name: 'Contexto y Google' });
  expect(panel).toHaveTextContent('Tokens usados250'); expect(panel).toHaveTextContent('Tokens libres750');
  const info = within(panel).getByRole('button', { name: 'Qué mide este círculo' });
  expect(info).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(info); expect(panel).toHaveTextContent('hasta 12 intercambios');
  fireEvent.keyDown(info, { key: 'Escape' });
  expect(panel).toHaveAttribute('hidden'); expect(trigger()).toHaveFocus();
});
it('un error no muestra cero ni usa una cifra anterior; permite volver a medir explícitamente', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('ruta técnica secreta')).mockResolvedValueOnce(measurement());
  preview(); await screen.findByRole('button', { name: 'Contexto de esta conversación: no disponible' }); fireEvent.click(trigger());
  expect(screen.getByRole('status')).toHaveTextContent('No se ha podido medir');
  expect(screen.queryByText('ruta técnica secreta')).not.toBeInTheDocument();
  expect(screen.queryByText('0 % ocupado')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a medir' }));
  await screen.findByRole('button', { name: 'Contexto de esta conversación: 25 % ocupado' }); expect(post).toHaveBeenCalledTimes(2);
});
it('un resultado no disponible de Google conserva el estado desconocido', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({ ...measurement(), status: 'unavailable', usedTokens: null, limitTokens: null, remainingTokens: null, measurement: null, message: 'No está disponible ahora.' });
  preview(); await screen.findByRole('button', { name: /no disponible/ }); fireEvent.click(trigger());
  expect(screen.getByRole('status')).toHaveTextContent('No está disponible ahora.');
  expect(screen.queryByText('Tokens usados')).not.toBeInTheDocument();
});
it('el borrador se agrupa antes de medir y nunca muestra una cifra correspondiente al texto anterior', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement()); preview();
  await screen.findByRole('button', { name: /25 % ocupado/ });
  act(() => { useComposerStore.setState({ draft: 'Pri' }); });
  expect(trigger()).toHaveAccessibleName(/midiendo/);
  act(() => { useComposerStore.setState({ draft: 'Primer producto' }); });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls.at(-1)?.[1]).toMatchObject({ text: 'Primer producto' });
});
it('una respuesta retrasada del modelo anterior no reaparece al cambiar de modelo y esfuerzo', async () => {
  let oldResolve: ((result: ContextMeasurement) => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; })).mockResolvedValueOnce(measurement(900));
  preview(); await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  act(() => select('gemini-3.5-flash', 'low'));
  await screen.findByRole('button', { name: /90 % ocupado/ });
  await act(async () => { oldResolve?.(measurement(100)); });
  expect(trigger()).toHaveAccessibleName(/90 % ocupado/); expect(trigger()).toHaveClass('is-critical');
  expect(post.mock.calls.at(-1)?.[1]).toMatchObject({ model: 'gemini-3.5-flash', effort: 'low' });
});
it('otra conversación obtiene su medición propia y los mensajes nuevos actualizan la misma conversación', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValueOnce(measurement()).mockResolvedValueOnce(measurement(750)).mockResolvedValueOnce(measurement(800));
  preview(); await screen.findByRole('button', { name: /25 % ocupado/ });
  act(() => useWorkspaceStore.setState({ activeThreadId: 'thread-b', threads: [{ id: 'thread-b', title: 'Segundo', service: null, view: 'default', messages: [] }] }));
  expect(trigger()).toHaveAccessibleName(/midiendo/); await screen.findByRole('button', { name: /75 % ocupado/ });
  act(() => useWorkspaceStore.getState().pushMessage('thread-b', { role: 'assistant', text: 'Nueva respuesta' }));
  await screen.findByRole('button', { name: /80 % ocupado/ });
  expect(post.mock.calls[1][1]).toMatchObject({ threadId: 'thread-b' });
});
it('cambiar de cuenta descarta la caché y espera la selección propia sin filtrar la cifra anterior', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement()); const view = preview();
  await screen.findByRole('button', { name: /25 % ocupado/ });
  identity.account = 'other@example.test';
  act(() => { window.dispatchEvent(new Event('uonify:identity-changed')); });
  view.rerender(<QueryClientProvider client={client}><Preview /></QueryClientProvider>);
  expect(trigger()).toHaveAccessibleName(/no disponible/);
  expect(client.getQueryCache().findAll({ queryKey: ['uony-context', 'context@example.test'] })).toHaveLength(0);
  expect(post).toHaveBeenCalledTimes(1);
  act(() => select()); await screen.findByRole('button', { name: /25 % ocupado/ }); expect(post).toHaveBeenCalledTimes(2);
});
it('espera a terminar la respuesta y cuenta un chat nuevo sin crearlo', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement());
  useWorkspaceStore.setState({ activeThreadId: null, threads: [] });
  useUiStore.setState({ pendingReply: { threadId: 'thread-a', label: 'Respondiendo' } }); preview();
  fireEvent.click(trigger()); expect(screen.getByRole('status')).toHaveTextContent('cuando Uony termine');
  await new Promise(resolve => window.setTimeout(resolve, 450)); expect(post).not.toHaveBeenCalled();
  act(() => useUiStore.setState({ pendingReply: null })); await screen.findByRole('button', { name: /25 % ocupado/ });
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: null }); expect(useWorkspaceStore.getState().threads).toHaveLength(0);
});
it('abrir, cambiar, guardar y cerrar una ficha actualiza el contexto sin escribir ni esperar una respuesta', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement()); preview();
  await screen.findByRole('button', { name: /25 % ocupado/ });
  const product = { sku: 'A', revision: 1 } as PimProduct;
  act(() => setActiveProduct(product)); expect(trigger()).toHaveAccessibleName(/midiendo/);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2)); expect(post.mock.calls[1][1]).toMatchObject({ productContext: { sku: 'A', revision: 1 } });
  act(() => setActiveProduct({ ...product, revision: 2 }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3)); expect(post.mock.calls[2][1]).toMatchObject({ productContext: { sku: 'A', revision: 2 } });
  act(() => setActiveProduct({ ...product, sku: 'B' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(4)); expect(post.mock.calls[3][1]).toMatchObject({ productContext: { sku: 'B', revision: 1 } });
  act(() => setActiveProduct(null));
  await waitFor(() => expect(trigger()).toHaveAccessibleName(/25 % ocupado/));
  // La medida exacta sin ficha puede reutilizarse, pero nunca muestra la de B mientras cambia.
  expect(useComposerStore.getState().draft).toBe('');
});
it('Auto se vuelve a medir si cambia el catálogo disponible, aunque la preferencia y el borrador sigan iguales', async () => {
  select('auto', 'low');
  const post = vi.spyOn(api, 'post').mockResolvedValueOnce(measurement()).mockResolvedValueOnce({ ...measurement(600), modelLabel: 'Gemini Flash-Lite' });
  preview(); await screen.findByRole('button', { name: /25 % ocupado/ });
  act(() => {
    const data = useGooglePreferences.getState().data!;
    useGooglePreferences.setState({ data: { ...data, models: [...data.models,
      { id: 'gemini-3.5-flash-lite', label: 'Gemini Flash-Lite', short: 'Flash-Lite', detail: '', efforts: ['low'] }] } });
  });
  expect(trigger()).toHaveAccessibleName(/midiendo/); await screen.findByRole('button', { name: /60 % ocupado/ });
  // D-PROTECCIÓN: el popover no expone el motor; la re-medición ya la prueban el 60 % + post×2. El pie del popover marca «Uony».
  expect(post).toHaveBeenCalledTimes(2); fireEvent.click(trigger());
  expect(screen.getByRole('region')).toHaveTextContent('Uony');
  expect(screen.getByRole('region')).not.toHaveTextContent(/Gemini/);
});
it('recupera la ficha activada por un hermano antes de instalar la suscripción del compositor', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(measurement());
  function Product() { useEffect(() => { setActiveProduct({ sku: 'MOUNT', revision: 4 } as PimProduct); }, []); return null; }
  render(<QueryClientProvider client={client}><Product /><Preview /></QueryClientProvider>);
  await screen.findByRole('button', { name: /25 % ocupado/ });
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][1]).toMatchObject({ productContext: { sku: 'MOUNT', revision: 4 } });
});
it('mantiene el panel sobre el círculo al pasar de móvil a escritorio mientras sigue abierto', async () => {
  vi.spyOn(api, 'post').mockResolvedValue(measurement()); preview();
  await screen.findByRole('button', { name: /25 % ocupado/ });
  const form = trigger().closest('form')!;
  const panel = document.querySelector('.composer-context-panel') as HTMLElement;
  let width = 336, left = 10, buttonLeft = 300, panelWidth = 200;
  const rect = (rectLeft: number, rectWidth: number, top: number, bottom: number) => ({ left: rectLeft, right: rectLeft + rectWidth, width: rectWidth, top, bottom, height: bottom - top, x: rectLeft, y: top, toJSON: () => ({}) });
  vi.spyOn(form, 'getBoundingClientRect').mockImplementation(() => rect(left, width, 380, 500));
  vi.spyOn(trigger(), 'getBoundingClientRect').mockImplementation(() => rect(buttonLeft, 28, 460, 492));
  Object.defineProperty(form, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => panelWidth });
  fireEvent.click(trigger()); expect(panel.style.left).toBe('136px'); expect(panel.style.bottom).toBe('46px');
  width = 800; left = 400; buttonLeft = 900; panelWidth = 340;
  fireEvent(window, new Event('resize')); expect(panel.style.left).toBe('460px'); expect(panel.style.bottom).toBe('46px');
  expect(panel).not.toHaveAttribute('hidden');
});
it('con la hoja de conversación abierta (móvil) el panel cuenta toda la ventana: la hoja tapa el pie', async () => {
  vi.spyOn(api, 'post').mockResolvedValue(measurement()); preview();
  await screen.findByRole('button', { name: /25 % ocupado/ });
  const form = trigger().closest('form')!;
  const panel = document.querySelector('.composer-context-panel') as HTMLElement;
  const rect = (top: number, bottom: number, left = 0, right = 390) => ({ left, right, width: right - left, top, bottom, height: bottom - top, x: left, y: top, toJSON: () => ({}) });
  const edge = window.innerHeight;
  // El compositor de la hoja acaba a 8 px del borde; debajo, el pie global de dos filas (89 px).
  vi.spyOn(form, 'getBoundingClientRect').mockImplementation(() => rect(edge - 128, edge - 8));
  vi.spyOn(trigger(), 'getBoundingClientRect').mockImplementation(() => rect(edge - 48, edge - 24, 300, 324));
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 300 });
  const column = document.createElement('div');
  const footer = document.createElement('div');
  vi.spyOn(footer, 'getBoundingClientRect').mockImplementation(() => rect(edge - 89, edge));
  Object.assign(workspaceRefs, { column, footer });
  try {
    column.className = 'workspace-column is-module is-chat-sheet';
    fireEvent.click(trigger());
    // Justo encima de su botón (6 px), sin hueco: la hoja tapa el pie.
    expect(panel.style.bottom).toBe('46px');
    fireEvent.click(trigger());
    column.className = 'workspace-column is-module';
    fireEvent.click(trigger());
    // Sin la hoja, el pie está a la vista y el panel no baja de su borde.
    expect(panel.style.bottom).toBe('89px');
  } finally {
    Object.assign(workspaceRefs, { column: null, footer: null });
  }
});
