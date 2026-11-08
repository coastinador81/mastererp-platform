import { act, renderHook, waitFor } from '@testing-library/react';
import { api, ApiError } from '@/shared/api/client';
import { useCloudWindow } from '../hooks/useCloudWindow';

const identity = vi.hoisted(() => ({ account: 'owner@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const flowId = 'a'.repeat(64);
function popup() {
  const child = { opener: window, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false };
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window);
  return child;
}
beforeEach(() => { identity.account = 'owner@example.test'; vi.spyOn(window, 'focus').mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

it('abre la recuperación en la página oficial del proyecto y conserva la cuenta elegida', async () => {
  const child = popup();
  const view = renderHook(() => useCloudWindow(vi.fn()));
  await act(() => view.result.current.open('billing', identity.account, 'https://console.cloud.google.com/iam-admin/iam?project=uonify-own'));
  expect(child.location.replace).toHaveBeenCalledWith('https://console.cloud.google.com/iam-admin/iam?project=uonify-own&authuser=owner%40example.test');
});

it.each(['https://example.test/billing', 'http://console.cloud.google.com/billing', 'https://user:pass@console.cloud.google.com/billing'])('rechaza un destino de recuperación que no sea una página oficial segura: %s', async url => {
  const child = popup();
  const view = renderHook(() => useCloudWindow(vi.fn()));
  await act(() => view.result.current.open('billing', identity.account, url));
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(child.close).toHaveBeenCalled();
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.message).toContain('página oficial válida');
});

it('abre antes de la API y conserva Uonify aunque Google rompa la referencia a la ventana', async () => {
  const child = popup(); const done = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(api, 'post').mockImplementation(async () => {
    expect(window.open).toHaveBeenCalled();
    expect(child.opener).toBeNull();
    return { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', flowId } as never;
  });
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'success' });
  const { result } = renderHook(() => useCloudWindow(done));
  const original = window.location.href;
  await act(() => result.current.open('authorization'));
  child.closed = true; // COOP puede indicarlo sin que el usuario haya cerrado Google.
  expect(result.current.pending?.mode).toBe('authorization');
  expect(window.location.href).toBe(original);
  await waitFor(() => expect(done).toHaveBeenCalledWith('authorization'));
  expect(result.current.pending).toBeNull();
  expect(child.close).toHaveBeenCalled();
  expect(window.focus).toHaveBeenCalled();
});

it('un bloqueo de ventanas no inicia OAuth y explica cómo reintentar', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  const post = vi.spyOn(api, 'post');
  const { result } = renderHook(() => useCloudWindow(vi.fn()));
  await act(() => result.current.open('authorization'));
  expect(post).not.toHaveBeenCalled();
  expect(result.current.message).toMatch(/bloqueado/);
});

it('cancela el intento en servidor al cerrar y permite reintentar', async () => {
  const child=popup(); const done=vi.fn().mockResolvedValue(undefined);
  vi.spyOn(api,'post').mockResolvedValue({ authUrl:'https://accounts.google.com/o/oauth2/v2/auth', flowId });
  const cancel=vi.spyOn(api,'delete').mockResolvedValue({cancelled:true});
  const {result}=renderHook(()=>useCloudWindow(done));
  await act(()=>result.current.open('authorization'));
  await act(()=>result.current.resume());
  expect(cancel).toHaveBeenCalledWith('/connections/google-cloud/flows/'+flowId, expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(child.close).toHaveBeenCalled(); expect(result.current.pending).toBeNull();
});

it('desmontar el chat cierra la ventana y cancela el intento de esa cuenta', async () => {
  const child = popup();
  vi.spyOn(api,'post').mockResolvedValue({authUrl:'https://accounts.google.com/o/oauth2/v2/auth',flowId});
  const cancel = vi.spyOn(api,'delete').mockResolvedValue({cancelled:true});
  const done = vi.fn();
  const view = renderHook(() => useCloudWindow(done));
  await act(() => view.result.current.open('authorization'));
  view.unmount();
  expect(child.close).toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith('/connections/google-cloud/flows/'+flowId,expect.anything());
  expect(done).not.toHaveBeenCalled();
});

it('ignora una respuesta de apertura tardía si la cuenta ya cambió', async () => {
  const child = popup();
  let finish: (value: never) => void = () => {};
  vi.spyOn(api,'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const cancel = vi.spyOn(api,'delete');
  const done = vi.fn();
  const view = renderHook(() => useCloudWindow(done));
  let opening: Promise<void>;
  act(() => { opening = view.result.current.open('authorization'); });
  act(() => { identity.account = 'another@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => { finish({authUrl:'https://accounts.google.com/o/oauth2/v2/auth',flowId} as never); await opening; });
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(child.close).toHaveBeenCalled();
  expect(view.result.current.pending).toBeNull();
  expect(done).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('un resultado de autorización de la cuenta anterior no ejecuta la actualización del chat', async () => {
  const child = popup();
  vi.spyOn(api,'post').mockResolvedValue({authUrl:'https://accounts.google.com/o/oauth2/v2/auth',flowId});
  let finish: (value: never) => void = () => {};
  const get = vi.spyOn(api,'get').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const done = vi.fn();
  const view = renderHook(() => useCloudWindow(done));
  await act(() => view.result.current.open('authorization'));
  await waitFor(() => expect(get).toHaveBeenCalled());
  act(() => { identity.account = 'another@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => { finish({status:'success'} as never); });
  expect(done).not.toHaveBeenCalled();
  expect(child.close).toHaveBeenCalled();
  expect(view.result.current.message).toMatch(/sesión ha cambiado/);
});

it('facturación usa la cuenta conectada y vuelve a consultar sin asumir que terminó el alta', async () => {
  const child=popup(); const done=vi.fn().mockResolvedValue(undefined);
  const {result}=renderHook(()=>useCloudWindow(done));
  await act(()=>result.current.open('billing','cloud@example.test'));
  expect(child.location.replace).toHaveBeenCalledWith('https://console.cloud.google.com/billing?authuser=cloud%40example.test');
  expect(done).not.toHaveBeenCalled();
  await act(()=>result.current.resume());
  expect(done).toHaveBeenCalledWith('billing');
});

it('rechaza una URL de autorización ajena a Google', async () => {
  const child=popup(); const done=vi.fn();
  vi.spyOn(api,'post').mockResolvedValue({authUrl:'https://other.example.test',flowId});
  const {result}=renderHook(()=>useCloudWindow(done));
  await act(()=>result.current.open('authorization'));
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(child.close).toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
});

it.each(['google-cloud', 'google-drive'] as const)('devuelve el foco a Uonify y termina la espera si %s caduca', async connection => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', flowId });
  const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, { error: 'flow_expired' }));
  const { result } = renderHook(() => useCloudWindow(done, connection));
  await act(() => result.current.open('authorization'));
  await waitFor(() => expect(result.current.pending).toBeNull());
  expect(result.current.message).toMatch(/caducado/);
  expect(child.close).toHaveBeenCalled(); expect(window.focus).toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(1);
});

it('cierra la ventana y devuelve el foco si Google rechaza la autorización', async () => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', flowId });
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'error' });
  const { result } = renderHook(() => useCloudWindow(done, 'google-drive'));
  await act(() => result.current.open('authorization'));
  await waitFor(() => expect(result.current.pending).toBeNull());
  expect(child.close).toHaveBeenCalled(); expect(window.focus).toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled(); expect(result.current.message).toMatch(/No se ha completado/);
});

it.each(['google-cloud', 'google-drive'] as const)('rechaza otra identidad en %s y vuelve a la pestaña original', async connection => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', flowId });
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'error', error: 'account_mismatch' });
  const { result } = renderHook(() => useCloudWindow(done, connection));
  await act(() => result.current.open('authorization'));
  await waitFor(() => expect(result.current.pending).toBeNull());
  expect(child.close).toHaveBeenCalled(); expect(window.focus).toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled(); expect(result.current.message).toMatch(/misma cuenta/);
});
