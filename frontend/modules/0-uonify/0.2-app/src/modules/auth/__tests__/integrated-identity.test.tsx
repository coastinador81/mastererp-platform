import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { handlers } from '@/shared/mocks/handlers';
import { openSignIn } from '../index';
import { renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()), latency: () => Promise.resolve(),
}));
const server = setupServer(...handlers);
let hard: ReturnType<typeof vi.fn>;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  hard = resetAll();
  server.use(http.get(mock('/auth/config'), () => HttpResponse.json({
    provider: 'google', mode: 'redirect', providers: ['google'], onboardingStage: 'identity', ready: true,
  })));
});
afterEach(() => server.resetHandlers());

test('usa Google real y no abre el selector de correo de la demo', async () => {
  const user = userEvent.setup();
  server.use(http.post(mock('/auth/google/start'), () => HttpResponse.json({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' })));
  renderAuthApp('/');
  await act(() => openSignIn());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Continuar con ChatGPT' })).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  await waitFor(() => expect(hard).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=test'));
  expect(screen.queryByRole('dialog', { name: 'Continúa en Uonify' })).not.toBeInTheDocument();
});

test('muestra el fallo del backend sin crear sesión ni cambiar al modo demo', async () => {
  const user = userEvent.setup();
  server.use(http.post(mock('/auth/google/start'), () => HttpResponse.json({ message: 'El acceso con Google aún no está disponible.' }, { status: 503 })));
  renderAuthApp('/');
  await act(() => openSignIn());
  await user.click(await screen.findByRole('button', { name: 'Continuar con Google' }));
  await screen.findByText('El acceso con Google aún no está disponible.');
  expect(hard).not.toHaveBeenCalled();
  expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
});

test('recupera identidad persistida, mantiene el alta incompleta y cierra la sesión en servidor', async () => {
  const user = userEvent.setup();
  let authenticated = true;
  server.use(
    http.get(mock('/auth/session'), () => HttpResponse.json(authenticated ? {
      authenticated: true, email: 'qa@example.test', account: { email: 'qa@example.test', provider: 'google' },
      identity: { name: 'Cuenta QA', provider: 'google' }, onboardingStage: 'identity', profileComplete: false,
    } : { authenticated: false })),
    http.post(mock('/auth/logout'), () => { authenticated = false; return HttpResponse.json({ ok: true }); }),
  );
  renderAuthApp('/?auth=return');
  const dialog = within(await screen.findByRole('dialog', { name: 'Ya estás en Uonify.' }));
  expect(dialog.getByText('qa@example.test')).toBeVisible();
  expect(screen.getByTestId('status')).toHaveTextContent('onboarding');
  expect(screen.queryByRole('button', { name: 'Continuar al pago' })).not.toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(hard).toHaveBeenCalledWith('/'));
  expect(authenticated).toBe(false);
});
