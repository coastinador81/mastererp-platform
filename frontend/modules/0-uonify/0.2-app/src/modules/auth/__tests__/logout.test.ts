import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { logout } from '../api/authApi';
import { signInAs, signOutMock, resetAuthDb } from '../mocks/authDb';
import { handlers } from '../mocks/handlers';
import { signOut } from '../flows/account';
import { resetAll } from './harness';

const recovery = vi.hoisted(() => ({ run: vi.fn(), useMocks: true }));
vi.mock('@/shared/mocks/recover', () => ({ recoverMockWorker: recovery.run }));
vi.mock('@/shared/api/config', async original => ({
  ...await original<typeof import('@/shared/api/config')>(),
  get USE_MOCKS() { return recovery.useMocks; },
}));
vi.mock('@/shared/mocks/utils', async original => ({
  ...await original<typeof import('@/shared/mocks/utils')>(), latency: () => Promise.resolve(),
}));
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { recovery.run.mockReset(); recovery.useMocks = true; resetAuthDb(); signInAs('salida@example.test'); });
afterEach(() => server.resetHandlers());

test('reintenta una caída de red y cierra la sesión', async () => {
  let calls = 0;
  server.use(http.post(mock('/auth/logout'), () => {
    calls++;
    if (calls === 1) return HttpResponse.error();
    signOutMock();
    return HttpResponse.json({ ok: true });
  }));
  await expect(logout()).resolves.toBeUndefined();
  expect(calls).toBe(2);
});

test('si se perdió la respuesta pero la sesión ya está cerrada, no da un falso error', async () => {
  let calls = 0;
  server.use(http.post(mock('/auth/logout'), () => {
    calls++;
    signOutMock();
    return HttpResponse.error();
  }));
  await expect(logout()).resolves.toBeUndefined();
  expect(calls).toBe(1);
});

test('una sesión caducada confirmada con 401 también permite salir', async () => {
  server.use(
    http.post(mock('/auth/logout'), () => new HttpResponse(null, { status: 401 })),
    http.get(mock('/auth/session'), () => new HttpResponse(null, { status: 401 })),
  );
  await expect(logout()).resolves.toBeUndefined();
});

test.each([{}, null, '<html>Error</html>', { authenticated: true }])('no confunde una respuesta ambigua con una sesión cerrada: %j', async result => {
  server.use(
    http.post(mock('/auth/logout'), () => new HttpResponse(null, { status: 503 })),
    http.get(mock('/auth/session'), () => HttpResponse.json(result)),
  );
  await expect(logout()).rejects.toMatchObject({ status: 503 });
});

test('dos clics simultáneos no duplican la petición ni la navegación', async () => {
  const hard = resetAll();
  signInAs('salida@example.test');
  let calls = 0;
  server.use(http.post(mock('/auth/logout'), () => {
    calls++;
    signOutMock();
    return HttpResponse.json({ ok: true });
  }));
  await Promise.all([signOut(), signOut()]);
  expect(calls).toBe(1);
  expect(hard).toHaveBeenCalledTimes(1);
  expect(hard).toHaveBeenCalledWith('/');
});

test.each([404, 200])('recupera el servicio local tras recibir HTML con estado %s y confirma la salida', async status => {
  let active = false;
  recovery.run.mockImplementation(async () => { active = true; });
  server.use(
    http.post(mock('/auth/logout'), () => {
      if (!active) return new HttpResponse('<html>Vite</html>', { status });
      signOutMock();
      return HttpResponse.json({ ok: true });
    }),
    http.get(mock('/auth/session'), () => active
      ? HttpResponse.json({ authenticated: false })
      : new HttpResponse('<html>Vite</html>', { status })),
  );
  const hard = resetAll();
  await signOut();
  expect(recovery.run).toHaveBeenCalledTimes(1);
  expect(hard).toHaveBeenCalledWith('/');
  expect(sessionStorage.getItem('uonify-mock:auth-session')).toBe(JSON.stringify({ email: null }));
});

test('no intenta recuperar un worker ni oculta un 404 del backend real', async () => {
  recovery.useMocks = false;
  server.use(http.post(mock('/auth/logout'), () => new HttpResponse(null, { status: 404 })));
  await expect(logout()).rejects.toMatchObject({ status: 404 });
  expect(recovery.run).not.toHaveBeenCalled();
});
