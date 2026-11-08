import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../routes';
import { authState } from './authMock';

vi.mock('@/modules/auth', async () => (await import('./authMock')).authMock);
vi.mock('@google/model-viewer', () => ({}));

function renderAt(path: string) {
  const router = createMemoryRouter([...routes, { path: '/espacio', element: <p>Espacio de trabajo</p> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  authState.status = 'signed-out';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('rutas de la web pública', () => {
  test('la portada es la ruta raíz y cada vista se carga al visitarla', async () => {
    expect(routes[0].path).toBe('/');
    renderAt('/novedades');
    // La carga real de la vista diferida puede superar un segundo en la suite completa.
    expect(await screen.findByRole('heading', { level: 1, name: /Nuevas piezas/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  test('Privacidad y Condiciones se abren sin sesión', async () => {
    renderAt('/terminos');
    expect(await screen.findByRole('heading', { level: 1, name: 'Aviso legal y condiciones.' })).toBeInTheDocument();
    expect(document.title).toBe('Condiciones — Uonify');
  });

  test('las URL del prototipo redirigen a su ruta', async () => {
    const router = renderAt('/producto.html#erp');
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'));
    expect(router.state.location.hash).toBe('#erp');
    const legacy = renderAt('/index.html?view=empresa');
    await waitFor(() => expect(legacy.state.location.pathname).toBe('/sobre-uonify'));
    const workspace = renderAt('/index.html?view=espacio&service=erp');
    await waitFor(() => expect(workspace.state.location.pathname).toBe('/espacio'));
    expect(workspace.state.location.search).toBe('?service=erp');
  });
});
