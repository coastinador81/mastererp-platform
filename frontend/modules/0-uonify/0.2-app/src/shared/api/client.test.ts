import { api, errorMessage } from './client';

afterEach(() => vi.unstubAllGlobals());

test.each([200, 404])('rechaza HTML con estado %s sin repetir el pago', async status => {
  const fetch = vi.fn(async () => new Response('<html>Uonify</html>', { status }));
  vi.stubGlobal('fetch', fetch);
  const error = await api.post('/billing/checkout', { planId: 'basic' }).catch(error => error);
  expect(error).toMatchObject({ name: 'ApiError', status });
  expect(errorMessage(error)).toContain('El servicio no ha respondido correctamente');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('conserva los errores JSON del servicio y permite texto explícito', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ message: 'Elige otro plan.' }, { status: 409 }))
    .mockResolvedValueOnce(new Response('documento')));
  const error = await api.post('/billing/checkout', {}).catch(error => error);
  expect(errorMessage(error)).toBe('Elige otro plan.');
  await expect(api.get('/document', { responseType: 'text' })).resolves.toBe('documento');
});
