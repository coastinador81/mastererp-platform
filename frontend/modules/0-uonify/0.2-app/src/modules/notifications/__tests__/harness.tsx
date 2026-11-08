import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { NotificationsBell } from '../components/NotificationsBell';

/** Muestra la dirección actual para comprobar a dónde lleva cada notificación. */
function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

/** Cabecera mínima con la campana, un botón «fuera» y la dirección actual. */
function Header() {
  return (
    <>
      <header>
        <NotificationsBell />
        <button type="button">Fuera</button>
      </header>
      <Location />
    </>
  );
}

export function renderBell(path = '/espacio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const router = createMemoryRouter([{ path: '*', element: <Header /> }], { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client, router };
}

/** Sustituye matchMedia para simular un móvil (hoja inferior) y devuelve cómo deshacerlo. */
export function emulatePhone(): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === '(max-width: 640px)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => { window.matchMedia = original; };
}
