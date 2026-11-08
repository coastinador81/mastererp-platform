import { recordConsents } from '../mocks/authDb';
import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { queryClient } from '@/shared/api/queryClient';
import { mock } from '@/shared/mocks/utils';
import { AuthDialogs, openSignIn, requirePrompt, signOut } from '../index';
import { signInAs, storeProfile } from '../mocks/authDb';
import { handlers } from '../mocks/handlers';
import { STORAGE_KEYS } from '../model/storage';
import type { Profile } from '../model/types';
import { locationText, renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let hard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  hard = resetAll();
});

const ana: Profile = {
  firstName: 'Ana',
  lastName: 'García',
  name: 'Ana García',
  email: 'ana@tienda.es',
  ageRange: '25-34',
  role: 'brand',
  companySize: '2-10',
  company: '',
  primaryGoal: 'catalog',
  source: '',
  desiredPlan: 'max',
};

function signedInReady() {
  signInAs('ana@tienda.es');
  storeProfile('ana@tienda.es', ana);
  recordConsents('ana@tienda.es', TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version, acceptedAt: new Date().toISOString() }))); 
}

describe('guardas de la portada y del espacio', () => {
  test('sin sesión, el espacio vuelve a la portada', async () => {
    renderAuthApp('/espacio');
    await waitFor(() => expect(locationText()).toBe('/'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('con la sesión lista, la portada lleva al espacio (oculta mientras se resuelve)', async () => {
    signedInReady();
    renderAuthApp('/');
    expect(document.documentElement).toHaveClass('uon-resolving-home');
    await waitFor(() => expect(locationText()).toBe('/espacio'));
    expect(document.documentElement).not.toHaveClass('uon-resolving-home');
    expect(screen.getByTestId('account')).toHaveTextContent('Ana|ana@tienda.es|A|Plan Max');
  });

  test('con el alta a medias, la portada la retoma al cargar y el espacio la exige', async () => {
    signInAs('luis@tienda.es');
    renderAuthApp('/');
    expect(await screen.findByRole('dialog', { name: 'Condiciones de Uonify' })).toBeVisible();
    expect(within(screen.getByRole('dialog', { name: 'Condiciones de Uonify' })).getByLabelText('Correo electrónico')).toHaveValue('luis@tienda.es');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el alta' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(locationText()).toBe('/');
  });

  test('cerrar el alta dentro del espacio vuelve a la portada', async () => {
    signInAs('luis@tienda.es');
    renderAuthApp('/espacio');
    await screen.findByRole('dialog', { name: 'Condiciones de Uonify' });
    expect(screen.getByTestId('account')).toHaveTextContent('Completar perfil|Sesión iniciada|U|Sin plan activo');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(locationText()).toBe('/'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('la vuelta de OpenAI sin sesión avisa de que el acceso no se completó', async () => {
    renderAuthApp('/?auth=return');
    expect(screen.getByRole('dialog', { name: 'Preparando tu acceso' })).toBeInTheDocument();
    const signIn = await screen.findByRole('dialog', { name: 'Entra en Uonify' });
    expect(within(signIn).getByRole('status')).toHaveTextContent('El acceso no se ha completado. Puedes intentarlo de nuevo.');
    await waitFor(() => expect(locationText()).toBe('/'));
  });

  test('la vuelta de OpenAI con sesión continúa con el alta', async () => {
    signInAs('marta@tienda.es');
    renderAuthApp('/?auth=return');
    await screen.findByText('Preparando tu perfil');
    expect(await screen.findByRole('dialog', { name: 'Condiciones de Uonify' })).toBeVisible();
    await waitFor(() => expect(locationText()).toBe('/'));
  });
});

describe('cuenta y cierre de sesión', () => {
  test('«Ajustes de la cuenta» lleva a Configuración', async () => {
    signedInReady();
    renderAuthApp('/espacio');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes de la cuenta' }));
    await waitFor(() => expect(locationText()).toBe('/espacio/configuracion/cuenta'));
    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Mi cuenta' })).toBeNull();
  });

  test('si falla el cierre conserva la sesión y permite reintentar', async () => {
    signedInReady();
    server.use(http.post(mock('/auth/logout'), () => HttpResponse.json({ message: 'no' }, { status: 503 })));
    renderAuthApp('/espacio');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(() => signOut());
    expect(hard).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    server.resetHandlers();
    sessionStorage.setItem(STORAGE_KEYS.pendingPrompt, 'petición');
    await act(() => signOut());
    expect(hard).toHaveBeenCalledWith('/');
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingPrompt)).toBeNull();
  });

  test('signOut desde fuera del diálogo también cierra la sesión', async () => {
    signedInReady();
    renderAuthApp('/espacio');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(() => signOut());
    expect(hard).toHaveBeenCalledWith('/');
  });
});

describe('peticiones antes de entrar', () => {
  test('requirePrompt sin sesión abre el acceso con la petición; con sesión lista la ejecuta', async () => {
    renderAuthApp('/');
    const run = vi.fn();
    await act(() => requirePrompt('Crea la ficha del Jenga', run));
    expect(run).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog', { name: 'Entra en Uonify' })).getByText('Crea la ficha del Jenga')).toBeVisible();
    signedInReady();
    queryClient.removeQueries({ queryKey: ['auth'] });
    await act(() => requirePrompt('Otra petición', run));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('openSignIn con la sesión lista da la bienvenida y abre el espacio', async () => {
    signedInReady();
    renderAuthApp('/');
    await waitFor(() => expect(locationText()).toBe('/espacio'));
    await act(() => openSignIn());
    // Ya en el espacio no se repite la bienvenida.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('solo un anfitrión pinta los diálogos aunque haya dos montados', async () => {
    const router = createMemoryRouter([{ path: '/', element: <><AuthDialogs /><AuthDialogs /></> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await act(() => openSignIn());
    expect(document.querySelectorAll('#uon-auth-dialog')).toHaveLength(1);
  });
});
