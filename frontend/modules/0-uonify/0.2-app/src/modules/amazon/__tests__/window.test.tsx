import { act, cleanup, renderHook } from '@testing-library/react';
import { api, ApiError } from '@/shared/api/client';
import { useAmazonWindow } from '../hooks/useAmazonWindow';

const base = '/connections/amazon';
const flowId = 'a'.repeat(64);
const loginUri = 'https://oauth.example.test/integrations/amazon/login';
const launch = 'A'.repeat(64);
const authUrl = `${loginUri}?launch=${launch}`;
function popup() {
  const child = { opener: window, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false };
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window);
  return child;
}
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'pending' });
  vi.spyOn(api, 'delete').mockResolvedValue({ cancelled: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('abre la ventana y retira opener antes de esperar a la API, sin navegar Uonify', async () => {
  const child = popup(); const done = vi.fn();
  const original = window.location.href;
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', expect.stringContaining('popup=yes'));
    expect(child.opener).toBeNull();
    return { authUrl, flowId } as never;
  });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  expect(post).toHaveBeenCalledWith(`${base}/start`, {}, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(child.location.replace).toHaveBeenCalledWith(authUrl);
  expect(window.location.href).toBe(original);
  expect(result.current.pending?.flowId).toBe(flowId);
  expect(done).not.toHaveBeenCalled();
});

it('una ventana bloqueada no inicia ni acepta una autorización', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  const post = vi.spyOn(api, 'post');
  const { result } = renderHook(() => useAmazonWindow(vi.fn(), loginUri));
  await act(() => result.current.open('intent-test'));
  expect(post).not.toHaveBeenCalled();
  expect(result.current.pending).toBeNull();
  expect(result.current.message).toMatch(/bloqueado/);
});

it('acepta el intento indicado solo al ejecutar open y envía un cuerpo vacío', async () => {
  popup(); const post = vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  const { result } = renderHook(() => useAmazonWindow(vi.fn(), loginUri));
  expect(post).not.toHaveBeenCalled();
  await act(() => result.current.open('intent-test'));
  expect(post).toHaveBeenCalledWith(`${base}/intents/intent-test/accept`, {}, expect.any(Object));
});

it('un mensaje de éxito o el cierre de la ventana no sustituye el estado pendiente del servidor', async () => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  child.closed = true;
  act(() => window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin, data: { type: 'amazon-return', flowId, status: 'success' },
  })));
  await poll();
  expect(api.get).toHaveBeenCalledWith(`${base}/flows/${flowId}`, expect.any(Object));
  expect(done).not.toHaveBeenCalled();
  expect(result.current.pending?.flowId).toBe(flowId);
  expect(result.current.message).not.toMatch(/se ha conectado/);
});

it('espera a que termine el refresco tras success y cierra la ventana devolviendo el foco', async () => {
  const child = popup();
  let finish!: () => void;
  const refresh = new Promise<void>(resolve => { finish = resolve; });
  const done = vi.fn(() => refresh);
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.mocked(api.get).mockResolvedValue({ status: 'success' });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await poll();
  expect(done).toHaveBeenCalledTimes(1);
  expect(result.current.message).not.toMatch(/se ha conectado/);
  await act(async () => { finish(); await refresh; });
  expect(result.current.pending).toBeNull();
  expect(child.close).toHaveBeenCalled();
  expect(window.focus).toHaveBeenCalled();
  expect(result.current.message).toMatch(/Amazon se ha conectado/);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(done).toHaveBeenCalledTimes(1);
});

it('si falla el refresco no anuncia una conexión comprobada', async () => {
  popup();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.mocked(api.get).mockResolvedValue({ status: 'success' });
  const done = vi.fn().mockRejectedValue(new Error('Sin red'));
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await poll();
  expect(result.current.pending).toBeNull();
  expect(result.current.message).toMatch(/no podemos actualizar su estado/);
  expect(result.current.message).not.toMatch(/se ha conectado/);
});

it('cancela en el servidor, cierra y permite iniciar otro intento sin dar éxito', async () => {
  const child = popup(); const done = vi.fn();
  const post = vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await act(() => result.current.cancel());
  expect(api.delete).toHaveBeenCalledWith(`${base}/flows/${flowId}`);
  expect(child.close).toHaveBeenCalled();
  expect(result.current.pending).toBeNull();
  expect(done).not.toHaveBeenCalled();
  await act(() => result.current.open());
  expect(post).toHaveBeenCalledTimes(2);
});

it('conserva la espera cuando el servidor no puede confirmar la cancelación', async () => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.mocked(api.delete).mockRejectedValue(new Error('No se pudo cancelar'));
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await act(() => result.current.cancel());
  expect(result.current.pending?.flowId).toBe(flowId);
  expect(result.current.message).toBe('No se pudo cancelar');
  expect(child.close).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

it('descarta y cancela una respuesta de inicio recibida después de cancelar', async () => {
  const child = popup(); const done = vi.fn();
  let finish!: (value: { authUrl: string; flowId: string }) => void;
  const response = new Promise<{ authUrl: string; flowId: string }>(resolve => { finish = resolve; });
  vi.spyOn(api, 'post').mockReturnValue(response as never);
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  let opening!: Promise<boolean>;
  act(() => { opening = result.current.open(); });
  await act(() => result.current.cancel());
  await act(async () => { finish({ authUrl, flowId }); await opening; });
  expect(api.delete).toHaveBeenCalledWith(`${base}/flows/${flowId}`);
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(result.current.pending).toBeNull();
  expect(done).not.toHaveBeenCalled();
});

it('un doble clic mientras se inicia OAuth crea un solo intento', async () => {
  popup();
  const post = vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  const { result } = renderHook(() => useAmazonWindow(vi.fn(), loginUri));
  await act(async () => { await Promise.all([result.current.open(), result.current.open()]); });
  expect(post).toHaveBeenCalledTimes(1);
  expect(window.open).toHaveBeenCalledTimes(1);
});

it.each([false, true])('una cancelación antigua no cierra ni modifica un intento nuevo (fallo: %s)', async failed => {
  popup();
  const post = vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const deleting = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  vi.mocked(api.delete).mockReturnValueOnce(deleting);
  const { result } = renderHook(() => useAmazonWindow(vi.fn(), loginUri));
  await act(() => result.current.open());
  let cancelling!: Promise<boolean>;
  act(() => { cancelling = result.current.cancel(); });
  await act(() => result.current.cancel());
  expect(api.delete).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue({ status: 'success' });
  await poll();
  const nextId = 'b'.repeat(64);
  const nextWindow = popup();
  post.mockResolvedValue({ authUrl, flowId: nextId });
  await act(() => result.current.open());
  await act(async () => { if (failed) fail(new Error('Respuesta antigua')); else finish(); await cancelling; });
  expect(result.current.pending?.flowId).toBe(nextId);
  expect(result.current.message).not.toMatch(/Respuesta antigua|cancelada/);
  expect(nextWindow.close).not.toHaveBeenCalled();
});

it('un inicio rechazado cierra la ventana sin consultar un flujo ni dar éxito', async () => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockRejectedValue(new ApiError(503, { message: 'Amazon aún no está configurado.' }));
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await poll();
  expect(result.current.pending).toBeNull();
  expect(result.current.message).toBe('Amazon aún no está configurado.');
  expect(child.close).toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

it('un permiso denegado en Amazon no conecta la cuenta', async () => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.mocked(api.get).mockResolvedValue({ status: 'error', error: 'access_denied' });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await poll();
  expect(result.current.pending).toBeNull();
  expect(result.current.message).toMatch(/No has concedido el permiso/);
  expect(child.close).toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 410])('termina la espera sin conectar si el flujo devuelve HTTP %i', async status => {
  popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.mocked(api.get).mockRejectedValue(new ApiError(status, {}));
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  await poll();
  expect(result.current.pending).toBeNull();
  expect(result.current.message).toMatch(/caducado|sesión/);
  expect(done).not.toHaveBeenCalled();
});

it.each([
  'aB0_-'.repeat(8),
  launch,
])('permite el gateway exacto con un launch válido: %s', async token => {
  const child = popup();
  const url = `${loginUri}?launch=${token}`;
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl: url, flowId });
  const { result } = renderHook(() => useAmazonWindow(vi.fn(), loginUri));
  await act(() => result.current.open());
  expect(child.location.replace).toHaveBeenCalledWith(url);
});

it.each([
  `http://oauth.example.test/integrations/amazon/login?launch=${launch}`,
  `https://oauth.example.test.evil.test/integrations/amazon/login?launch=${launch}`,
  `https://evil.test/integrations/amazon/login?launch=${launch}`,
  `https://user@oauth.example.test/integrations/amazon/login?launch=${launch}`,
  `https://oauth.example.test:8443/integrations/amazon/login?launch=${launch}`,
  `${authUrl}#other`,
  `https://oauth.example.test/integrations/amazon/callback?launch=${launch}`,
  `${loginUri}/?launch=${launch}`,
  `${loginUri}?launch=${launch}&launch=${launch}`,
  `${authUrl}&next=https://evil.test`,
  `${loginUri}?other=${launch}`,
  `${loginUri}?launch=${'A'.repeat(39)}`,
  `${loginUri}?launch=${'A'.repeat(65)}`,
  `${loginUri}?launch=${'A'.repeat(40)}%2F`,
  `${loginUri}?launch=`,
  loginUri,
  'https://sellercentral.amazon.com/apps/authorize/consent?version=beta',
  'https://amazon.com/apps/authorize/confirm/app-test?amazon_state=test',
])('rechaza una URL insegura y cancela el intento: %s', async url => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl: url, flowId });
  const { result } = renderHook(() => useAmazonWindow(done, loginUri));
  await act(() => result.current.open());
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(api.delete).toHaveBeenCalledWith(`${base}/flows/${flowId}`);
  expect(child.close).toHaveBeenCalled();
  expect(result.current.pending).toBeNull();
  expect(done).not.toHaveBeenCalled();
});

it.each([
  undefined,
  null,
  'http://oauth.example.test/integrations/amazon/login',
  `${loginUri}?extra=value`,
  `${loginUri}#fragment`,
  'https://user@oauth.example.test/integrations/amazon/login',
])('no navega sin una Login URI HTTPS válida configurada: %s', async configured => {
  const child = popup(); const done = vi.fn();
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  const { result } = renderHook(() => useAmazonWindow(done, configured));
  await act(() => result.current.open());
  expect(child.location.replace).not.toHaveBeenCalled();
  expect(result.current.pending).toBeNull();
  expect(done).not.toHaveBeenCalled();
});
