import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { queryClient } from '@/shared/api/queryClient';
import { mock } from '@/shared/mocks/utils';
import { openSignIn } from '../index';
import { fetchAuthConfig } from '../api/authApi';
import { submitIdentity } from '../flows/access';
import { CONFIG_KEY, ensureAuthConfig } from '../state/session';
import { getUi, patchConnect } from '../state/authUi';
import { handlers } from '../mocks/handlers';
import { renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async original => ({ ...await original<typeof import('@/shared/mocks/utils')>(), latency: () => Promise.resolve() }));
const recovery = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/shared/mocks/recover', () => ({ recoverMockWorker: recovery }));
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => { resetAll(); recovery.mockClear(); });

test.each(['html', 'network', 'server'])('recupera el acceso tras %s sin devolver al selector ni iniciar OAuth equivocado', async failure => {
  let requests = 0;
  let starts = 0;
  server.use(
    http.get(mock('/auth/config'), () => {
      requests++;
      if (requests > 1) return HttpResponse.json({ provider: 'chatgpt', mode: 'preview' });
      if (failure === 'network') return HttpResponse.error();
      if (failure === 'server') return new HttpResponse(null, { status: 503 });
      return HttpResponse.html('<html>Uonify</html>');
    }),
    http.post(mock('/auth/chatgpt/start'), () => { starts++; return HttpResponse.json({ authUrl: '/?auth=return' }); }),
  );
  const user = userEvent.setup();
  renderAuthApp(); await act(() => openSignIn());
  await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
  await screen.findByRole('dialog', { name: 'Continúa en Uonify' });
  expect(screen.queryByRole('dialog', { name: 'Entra en Uonify' })).toBeNull();
  expect(starts).toBe(0);
  expect(recovery).toHaveBeenCalledTimes(1);
});

test('un fallo persistente no se guarda como modo redirect; el siguiente intento recupera sin recargar', async () => {
  server.use(http.get(mock('/auth/config'), () => new HttpResponse(null, { status: 503 })));
  await expect(ensureAuthConfig()).rejects.toMatchObject({ status: 503 });
  expect(queryClient.getQueryData(CONFIG_KEY)).toBeUndefined();
  server.resetHandlers();
  await expect(ensureAuthConfig()).resolves.toMatchObject({ mode: 'preview' });
});

test.each([null, {}, { mode: 'unknown' }])('rechaza configuración inválida: %j', async data => {
  server.use(http.get(mock('/auth/config'), () => HttpResponse.json(data)));
  await expect(fetchAuthConfig()).rejects.toThrow('auth-config-invalid');
});

test('cada intento comprueba el modo actual y no reutiliza una configuración obsoleta', async () => {
  queryClient.setQueryData(CONFIG_KEY, { mode: 'redirect', provider: 'chatgpt' });
  await expect(ensureAuthConfig()).resolves.toMatchObject({ mode: 'preview' });
});

test('un fallo al confirmar el correo permite reintentar y no deja el formulario bloqueado', async () => {
  patchConnect({ provider: 'chatgpt', submitting: false });
  server.use(http.get(mock('/auth/config'), () => new HttpResponse(null, { status: 503 })));
  await expect(submitIdentity('recuperar@example.test')).resolves.toBeUndefined();
  expect(getUi().connect.submitting).toBe(false);
  expect(getUi().signIn.providerDisabled).toBe(false);
  server.resetHandlers();
  await submitIdentity('recuperar@example.test');
  await waitFor(() => expect(getUi().dialog).toBe('profile'));
});
