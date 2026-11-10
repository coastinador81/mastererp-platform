import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { openSignIn } from '../index';
import { navigation } from '../flows/navigation';
import { STORAGE_KEYS } from '../model/storage';
import { configureTiming } from '../model/timing';
import { signInAs } from '../mocks/authDb';
import { handlers } from '@/shared/mocks/handlers';
import { completeProfile, connectAs, FAST, locationText, renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

let hard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  hard = resetAll();
});

describe('capa de transición', () => {
  test('si el acceso tarda demasiado: aviso, «Intentar de nuevo» con foco y «Volver»', async () => {
    const user = userEvent.setup();
    configureTiming({ ...FAST, watchdog: 150 });
    server.use(http.get(mock('/auth/config'), async () => {
      await delay('infinite');
      return HttpResponse.json({});
    }));
    renderAuthApp('/');
    await act(() => openSignIn());
    await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
    expect(await screen.findByText('Lleva más tiempo de lo esperado')).toBeVisible();
    expect(screen.getByText('Puedes volver a intentarlo para continuar.')).toBeVisible();
    const layer = screen.getByRole('dialog', { name: 'Lleva más tiempo de lo esperado' });
    expect(layer).toHaveClass('is-error');
    const retry = screen.getByRole('button', { name: 'Intentar de nuevo' });
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(screen.getByRole('dialog', { name: 'Entra en Uonify' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Volver' }));
    expect(hard).toHaveBeenCalledWith('/');
  });

  test('si no se abre el espacio: «Vamos a intentarlo de nuevo» y el reintento lo consigue', async () => {
    const user = userEvent.setup();
    configureTiming({ ...FAST, ready: 20, workspaceTimeout: 400 });
    signInAs('ana@tienda.es');
    renderAuthApp('/');
    const go = vi.spyOn(navigation, 'go').mockImplementation(() => {});
    await completeProfile(user);
    expect(await screen.findByText('Vamos a intentarlo de nuevo', undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText('Tu perfil está guardado. No hemos podido abrir el espacio de trabajo.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Vamos a intentarlo de nuevo' })).toHaveAttribute('data-context', 'workspace');
    expect(locationText()).toBe('/');

    go.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    await waitFor(() => expect(locationText()).toBe('/espacio'), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(hard).not.toHaveBeenCalled();
  });

  test('los tres indicadores avanzan con los mensajes de bienvenida', async () => {
    const user = userEvent.setup();
    configureTiming({ ...FAST, message: 120, ready: 150 });
    signInAs('ana@tienda.es');
    renderAuthApp('/');
    await completeProfile(user);
    const layer = await screen.findByRole('dialog', { name: 'Preparando tu entorno' });
    expect(screen.getByText('TODO EMPIEZA AQUÍ')).toBeVisible();
    const steps = () => [...layer.querySelectorAll('.uon-transition-steps span')].map(step => step.className);
    expect(steps()).toEqual(['is-current', '', '']);
    await screen.findByText('Un espacio a tu medida');
    expect(steps()).toEqual(['is-complete', 'is-current', '']);
    await screen.findByText('Casi estamos');
    await screen.findByText('Todo listo, Ana');
    expect(steps()).toEqual(['is-complete', 'is-complete', 'is-complete']);
    expect(layer).toHaveClass('is-ready');
    await waitFor(() => expect(locationText()).toBe('/espacio'), { timeout: 3000 });
  });
});

describe('servicio pulsado sin sesión en el panel «Tu espacio Uonify»', () => {
  test('openSignIn({ service: "erp" }) lo guarda y, al entrar, el espacio se abre en /espacio?service=erp', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await act(() => openSignIn({ service: 'erp' }));
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBe('erp');
    expect(screen.getByRole('dialog', { name: 'Entra en Uonify' })).toBeVisible();
    await connectAs(user, 'ana@tienda.es');
    await completeProfile(user);
    await waitFor(() => expect(locationText()).toBe('/espacio?service=erp'), { timeout: 3000 });
    // Se usa una sola vez: la siguiente entrada ya no lo arrastra.
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBeNull();
  });

  test('sin servicio pendiente, al entrar el espacio se abre en /espacio', async () => {
    const user = userEvent.setup();
    signInAs('ana@tienda.es');
    renderAuthApp('/');
    await act(() => openSignIn());
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBeNull();
    await completeProfile(user);
    await waitFor(() => expect(locationText()).toBe('/espacio'), { timeout: 3000 });
  });

  test('cerrar el acceso descarta el servicio: después, «Iniciar sesión» entra en /espacio', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await act(() => openSignIn({ service: 'erp' }));
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBe('erp');
    await user.click(screen.getByRole('button', { name: 'Cerrar acceso' }));
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await connectAs(user, 'ana@tienda.es');
    await completeProfile(user);
    await waitFor(() => expect(locationText()).toBe('/espacio'), { timeout: 3000 });
  });

  test('manda la última intención: un acceso sin servicio descarta el que quedaba pendiente', async () => {
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    sessionStorage.setItem(STORAGE_KEYS.pendingService, 'erp');
    await act(() => openSignIn());
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Entra en Uonify' })).toBeVisible();
  });

  test('solo guarda un identificador de servicio válido', async () => {
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await act(() => openSignIn({ service: 'erp?next=/admin' }));
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingService)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Entra en Uonify' })).toBeVisible();
  });
});
