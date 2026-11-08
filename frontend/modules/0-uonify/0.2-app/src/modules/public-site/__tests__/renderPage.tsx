import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

/** Pinta una vista pública en un router de memoria (con /espacio para ver redirecciones). */
export function renderPage(element: ReactElement, path = '/') {
  const router = createMemoryRouter(
    [
      { path: '/espacio', element: <p>Espacio de trabajo</p> },
      { path: '*', element },
    ],
    { initialEntries: [path] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}
