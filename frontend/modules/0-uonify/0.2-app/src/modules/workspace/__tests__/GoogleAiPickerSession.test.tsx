import { useRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { GoogleAiPicker } from '../components/composer/GoogleAiPicker';
import { useGooglePreferences, type GoogleOptions } from '../hooks/googlePreferences';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';

const identity = vi.hoisted(() => ({ account: null as string | null, listeners: new Set<() => void>(), signIn: vi.fn() }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    currentAccountEmail: () => identity.account, openSignIn: identity.signIn,
    useSession: () => {
      const account = useSyncExternalStore(callback => { identity.listeners.add(callback); return () => identity.listeners.delete(callback); }, () => identity.account);
      return { status: account ? 'ready' : 'loading', user: account ? { email: account } : null };
    },
  };
});
function options(label = 'Flash'): GoogleOptions {
  return { models: [{ id: 'gemini-3.5-flash', label, short: label, detail: '', efforts: ['low', 'medium', 'high'] }],
    efforts: [{ id: 'low', label: 'Bajo' }, { id: 'medium', label: 'Medio' }, { id: 'high', label: 'Alto' }],
    preferences: { model: 'gemini-3.5-flash', effort: 'medium' }, autoPolicy: 'Auto usa Flash-Lite en Bajo y Flash en Medio o Alto.' };
}
function changeAccount(account: string | null) { act(() => { identity.account = account; identity.listeners.forEach(callback => callback()); }); }
function Picker({ onSignIn }: { onSignIn?: () => void }) { const form = useRef<HTMLFormElement>(null); return <form ref={form}><GoogleAiPicker form={form} onSignIn={onSignIn} /></form>; }
function mount(onSignIn?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><Picker onSignIn={onSignIn} /></QueryClientProvider>) };
}
beforeEach(() => {
  identity.account = null; identity.signIn.mockReset(); sessionStorage.clear();
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  useComposerStore.setState({ draft: '', picker: null, status: '' }); setUi({ pendingReply: null });
});
afterEach(() => vi.restoreAllMocks());

it.each(['Respuesta ágil: iniciar sesión', 'Modelo: Auto. Razonamiento: Medio. Iniciar sesión'])(
  'el control visitante %s abre el acceso con el borrador, sin desplegar ni consultar nada', async name => {
    const get = vi.spyOn(api, 'get'), put = vi.spyOn(api, 'put'), post = vi.spyOn(api, 'post');
    useGooglePreferences.setState({ account: 'anterior@example.test', data: options('Anterior') });
    useComposerStore.setState({ draft: 'Mi producto sin terminar', picker: 'model' });
    sessionStorage.setItem('uonify-google-visitor-preferences', JSON.stringify({ preferences: { model: 'gemini-3.1-pro-preview', effort: 'high' }, pending: true }));
    mount();
    const selector = screen.getByRole('button', { name: 'Modelo: Auto. Razonamiento: Medio. Iniciar sesión' });
    expect(selector).toHaveTextContent('Auto');
    expect(selector).toHaveTextContent('Medio');
    expect(screen.getAllByRole('button', { name: /^Modelo:/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Razonamiento:/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name }));
    expect(identity.signIn).toHaveBeenCalledWith({ prompt: 'Mi producto sin terminar' });
    expect(useComposerStore.getState().draft).toBe('Mi producto sin terminar');
    expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Cargando IA…')).not.toBeInTheDocument(); expect(screen.queryByText('Uony')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  },
);

it('los controles también abren el acceso con un borrador vacío y funcionan con el teclado', async () => {
  mount(); const button = screen.getByRole('button', { name: 'Modelo: Auto. Razonamiento: Medio. Iniciar sesión' });
  button.focus(); await userEvent.keyboard('{Enter}');
  expect(identity.signIn).toHaveBeenCalledWith({ prompt: '' });
  expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument();
});

it('el callback del compositor conserva su propio borrador sin recurrir al estado de otro compositor', async () => {
  const access = vi.fn(); useComposerStore.setState({ draft: 'Borrador de otro compositor' }); mount(access);
  await userEvent.click(screen.getByRole('button', { name: 'Modelo: Auto. Razonamiento: Medio. Iniciar sesión' }));
  expect(access).toHaveBeenCalledOnce(); expect(identity.signIn).not.toHaveBeenCalled();
});

it('se suscribe al acceso y la salida sin presentar modelos de la cuenta anterior ni consultar un catálogo público', async () => {
  let resolve!: (value: GoogleOptions) => void;
  const get = vi.spyOn(api, 'get').mockImplementation(path => { expect(path).toBe('/uony/options'); return new Promise<GoogleOptions>(done => { resolve = done; }) as never; });
  mount(); expect(get).not.toHaveBeenCalled(); changeAccount('uno@example.test');
  expect(screen.getByRole('button', { name: 'Comprobando modelos de IA' })).toHaveTextContent('Cargando IA…');
  await act(async () => resolve(options('Modelo propio')));
  expect(await screen.findByRole('button', { name: 'Modelo: Modelo propio. Razonamiento: Medio. Ajustar IA' })).toBeEnabled();
  changeAccount(null);
  expect(screen.getByRole('button', { name: 'Modelo: Auto. Razonamiento: Medio. Iniciar sesión' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Modelo: Modelo propio/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Cargando IA…')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledOnce();
});

it('aborta la lectura anterior al cambiar de cuenta y nunca restaura sus preferencias tardías', async () => {
  let first!: (value: GoogleOptions) => void, second!: (value: GoogleOptions) => void;
  const get = vi.spyOn(api, 'get').mockImplementationOnce(() => new Promise<GoogleOptions>(done => { first = done; }) as never)
    .mockImplementationOnce(() => new Promise<GoogleOptions>(done => { second = done; }) as never);
  const put = vi.spyOn(api, 'put'); identity.account = 'uno@example.test';
  const { client } = mount(); const firstSignal = get.mock.calls[0][1]?.signal;
  changeAccount('dos@example.test'); expect(firstSignal?.aborted).toBe(true);
  await act(async () => second(options('Segunda cuenta')));
  expect(await screen.findByRole('button', { name: 'Modelo: Segunda cuenta. Razonamiento: Medio. Ajustar IA' })).toBeEnabled();
  await act(async () => first(options('Primera cuenta')));
  expect(useGooglePreferences.getState().account).toBe('dos@example.test');
  expect(useGooglePreferences.getState().data?.preferences.effort).toBe('medium');
  expect(client.getQueryData(['uony-options', 'uno@example.test'])).toBeUndefined(); expect(put).not.toHaveBeenCalled();
});

it('ignora una antigua elección anónima al entrar y utiliza únicamente la preferencia real de la cuenta', async () => {
  sessionStorage.setItem('uonify-google-visitor-preferences', JSON.stringify({ preferences: { model: 'gemini-3.1-pro-preview', effort: 'high' }, pending: true, account: 'uno@example.test' }));
  identity.account = 'uno@example.test'; const get = vi.spyOn(api, 'get').mockResolvedValue(options());
  const put = vi.spyOn(api, 'put'), post = vi.spyOn(api, 'post'); mount();
  const selector = await screen.findByRole('button', { name: 'Modelo: Flash. Razonamiento: Medio. Ajustar IA' });
  expect(selector).toBeEnabled();
  expect(selector).toHaveTextContent('Flash');
  expect(selector).toHaveTextContent('Medio');
  expect(screen.getAllByRole('button', { name: /Ajustar IA$/ })).toHaveLength(1);
  expect(useGooglePreferences.getState().data?.preferences).toEqual(options().preferences);
  expect(get).toHaveBeenCalledWith('/uony/options', { signal: expect.any(AbortSignal) });
  expect(put).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

it('un fallo privado conserva el reintento explícito y recupera los modelos sin configurar otra conexión', async () => {
  identity.account = 'uno@example.test';
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('No disponible')).mockResolvedValueOnce(options());
  mount(); const retry = await screen.findByRole('button', { name: 'Reintentar carga de modelos' }); await userEvent.click(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Modelo: Flash. Razonamiento: Medio. Ajustar IA' })).toBeEnabled());
  expect(get).toHaveBeenCalledTimes(2); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
