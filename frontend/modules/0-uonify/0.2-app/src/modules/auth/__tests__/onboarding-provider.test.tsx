import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { handlers } from '@/shared/mocks/handlers';
import { mock } from '@/shared/mocks/utils';
import { openSignIn } from '../index';
import { consentsOf, planOf, signInAs } from '../mocks/authDb';
import { completeConsents, completePersonalDetails, renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetAll());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const email = 'prueba@example.test';

test('ChatGPT puede seguir sin conceder permiso y retomar el perfil sin volver a pedirlo', async () => {
  const user = userEvent.setup();
  signInAs(email, 'chatgpt');
  renderAuthApp();
  const terms = within(await screen.findByRole('dialog', { name: 'Condiciones de Uonify' }));
  for (const check of terms.getAllByRole('checkbox').slice(0, 3)) await user.click(check);
  await user.click(terms.getByRole('button', { name: 'Aceptar y continuar' }));
  await screen.findByRole('dialog', { name: 'Empecemos por ti' });
  expect(planOf(email).status).toBe('not_connected');
  expect(consentsOf(email).map(item => item.id)).not.toContain('chatgpt-plan');
  await user.click(screen.getByRole('button', { name: 'Cerrar el alta' }));
  await act(() => openSignIn());
  await screen.findByRole('dialog', { name: 'Empecemos por ti' });
  await completePersonalDetails(user);
  expect(await screen.findByRole('dialog', { name: 'Elige tu plan' })).toBeVisible();
  expect(screen.queryByText('Conecta tu plan de ChatGPT')).toBeNull();
});

test('permiso integrado: un fallo mantiene las condiciones y permite reintentar sin repetir el permiso después', async () => {
  const user = userEvent.setup();
  signInAs(email, 'chatgpt');
  server.use(http.post(mock('/auth/chatgpt/plan'), () => HttpResponse.json({}, { status: 503 })));
  renderAuthApp();
  await completeConsents(user);
  expect(await screen.findByText(/No se pudo autorizar/)).toBeVisible();
  expect(planOf(email).status).toBe('not_connected');
  expect(screen.getByRole('dialog', { name: 'Condiciones de Uonify' })).toBeVisible();
  server.resetHandlers();
  await user.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
  await screen.findByRole('dialog', { name: 'Empecemos por ti' });
  expect(planOf(email).status).toBe('connected');
  expect(consentsOf(email).filter(item => item.id === 'chatgpt-plan')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByText('Ya has autorizado el uso de tu plan de ChatGPT.')).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: /Autorizo a Uonify/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
  await completePersonalDetails(user);
  expect(await screen.findByRole('dialog', { name: 'Elige tu plan' })).toBeVisible();
});

test.each(['google', 'email'] as const)('%s conserva la conexión opcional después del perfil', async provider => {
  const user = userEvent.setup();
  signInAs(email, provider);
  renderAuthApp();
  const terms = await screen.findByRole('dialog', { name: 'Condiciones de Uonify' });
  expect(within(terms).getAllByRole('checkbox')).toHaveLength(3);
  expect(screen.getByText('PASO 1 DE 6 · CONDICIONES')).toBeVisible();
  await completeConsents(user);
  await completePersonalDetails(user);
  const connect = within(await screen.findByRole('dialog', { name: 'Conecta tu plan de ChatGPT' }));
  expect(planOf(email).status).toBe('not_connected');
  await user.click(connect.getByRole('radio', { name: /Conectar mi plan de ChatGPT/ }));
  expect(connect.getByRole('checkbox', { name: /Autorizo a Uonify/ })).not.toBeChecked();
  await user.click(connect.getByRole('checkbox', { name: /Autorizo a Uonify/ }));
  await user.click(connect.getByRole('button', { name: 'Conectar y continuar' }));
  expect(await screen.findByRole('dialog', { name: 'Elige tu plan' })).toBeVisible();
  expect(planOf(email).status).toBe('connected');
});
