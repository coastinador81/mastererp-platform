import { api, ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { SIGNED_OUT } from '../model/session';
import { SESSION_KEY, sessionQuery, setSession } from '../state/session';

const account = 'owner@example.test';
beforeEach(() => {
  queryClient.clear(); sessionStorage.clear(); localStorage.clear();
  setSession({ ...SIGNED_OUT, authenticated: true, email: account });
  sessionStorage.setItem('uonify-product-guides-v1', 'private');
  localStorage.setItem(`${account}:scraped_images_SKU`, 'private');
  localStorage.setItem('other@example.test:scraped_images_SKU', 'other');
  queryClient.setQueryData(['private', account], 'private');
});
afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); sessionStorage.clear(); localStorage.clear(); });
const check = () => queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });

test('una sesión cerrada confirmada por GET limpia la cuenta sin cancelar ni repetir esa consulta', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ authenticated: false });
  const listener = vi.fn(); window.addEventListener('uonify:identity-changed', listener);
  const result = await check();
  expect(result.authenticated).toBe(false); expect(listener).toHaveBeenCalledOnce();
  expect(api.get).toHaveBeenCalledOnce(); expect(queryClient.getQueryState(SESSION_KEY)?.status).toBe('success');
  expect(queryClient.getQueryData(['private', account])).toBeUndefined();
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBeNull();
  expect(localStorage.getItem(`${account}:scraped_images_SKU`)).toBeNull();
  expect(localStorage.getItem('other@example.test:scraped_images_SKU')).toBe('other');
  window.removeEventListener('uonify:identity-changed', listener);
});

test.each([new TypeError('offline'), new ApiError(503, {}), new ApiError(401, {})])('una caída o error no acredita cierre ni borra borradores: %s', async reason => {
  vi.spyOn(api, 'get').mockRejectedValue(reason);
  await check();
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBe('private');
  expect(queryClient.getQueryData(['private', account])).toBe('private');
  // Si el siguiente GET sí confirma el cierre, todavía se conoce la cuenta cuyos datos retirar.
  vi.mocked(api.get).mockResolvedValue({ authenticated: false }); await check();
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBeNull();
});

test.each([{}, null, { authenticated: 'false' }])('una respuesta ambigua no borra los datos: %j', async payload => {
  vi.spyOn(api, 'get').mockResolvedValue(payload); await check();
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBe('private');
  expect(queryClient.getQueryData(['private', account])).toBe('private');
});

test('un GET viejo no limpia la cuenta que entró mientras esperaba su respuesta', async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = check();
  setSession({ ...SIGNED_OUT, authenticated: true, email: 'other@example.test' });
  finish({ authenticated: false }); await pending;
  expect(queryClient.getQueryData(SESSION_KEY)).toMatchObject({ authenticated: true, email: 'other@example.test' });
  expect(localStorage.getItem('other@example.test:scraped_images_SKU')).toBe('other');
});
