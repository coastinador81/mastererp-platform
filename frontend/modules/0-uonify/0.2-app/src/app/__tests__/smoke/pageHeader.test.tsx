import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, settle, setupSmokeServer } from './harness';

// jsdom no tiene WebGL: <model-viewer> se queda sin definir, como antes de cargar.
vi.mock('@google/model-viewer', () => ({}));

setupSmokeServer();

/** Pinta la ruta con la app completa y devuelve su cabecera, ya con la sesión resuelta. */
async function pageHeader(path: string): Promise<HTMLElement> {
  renderApp(path);
  await waitFor(() => expect(document.querySelector('header.header--row')).not.toBeNull(), { timeout: 5000 });
  await settle();
  const headers = document.querySelectorAll<HTMLElement>('header.header--row');
  expect(headers).toHaveLength(1);
  return headers[0];
}

/** Marcado de la cabecera sin la marca de página actual (las interiores marcan la suya). */
const markup = (header: HTMLElement) => header.outerHTML.replace(/ aria-current="page"/g, '').replace(/ is-active/g, '').replace(/>\s+</g, '><').trim();

/** Las 10 páginas interiores del menú. */
const MENU = [
  '/productos', '/lo-que-puedes-hacer', '/como-funciona', '/precios', '/para-empresas',
  '/sobre-uonify', '/seguridad', '/partners', '/clientes', '/novedades',
];

/** Orden de los enlaces en la fila: «Servicios ▾» (3), Cómo funciona, Precios, Clientes y «Empresa ▾» (4). */
const NAV_ORDER = [
  '/productos', '/lo-que-puedes-hacer', '/para-empresas', '/como-funciona', '/precios',
  '/clientes', '/sobre-uonify', '/seguridad', '/partners', '/novedades',
];

/** El resto de páginas públicas con la cabecera común (todas menos la portada). Ayuda, un artículo y las legales no están en el menú. */
const OTHER_PAGES = [...MENU.slice(1), '/ayuda', '/ayuda/precio-y-pago', '/terminos', '/privacidad'];

/** Cabecera de referencia: la de /productos, la primera del menú. */
let expected = '';

describe('cabecera de las páginas públicas en la aplicación completa', () => {
  test('/productos: menú en una fila con sus desplegables, su página marcada, acceso y botón de servicios', async () => {
    const header = await pageHeader('/productos');
    const nav = within(header).getByRole('navigation', { name: 'Navegación principal' });
    expect([...nav.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(NAV_ORDER);
    expect(within(nav).getByRole('button', { name: 'Servicios' })).toHaveClass('is-active');
    expect(nav.querySelector('a[href="/productos"]')).toHaveAttribute('aria-current', 'page');
    expect(within(header).getByRole('link', { name: /Iniciar sesión/ })).toHaveClass('login-link');
    expect(within(header).getByRole('button', { name: 'Herramientas de Uonify' })).toBeInTheDocument();
    expected = markup(header);
  });

  test.each(OTHER_PAGES)('%s lleva la misma cabecera que /productos', async path => {
    expect(expected, 'falta la cabecera de referencia').not.toBe('');
    const header = await pageHeader(path);
    // La fila y el menú del móvil marcan la página actual: cada interior la suya; Ayuda y las legales, ninguna.
    const current = [...new Set([...header.querySelectorAll('[aria-current]')].map(link => link.getAttribute('href')))];
    expect(current).toEqual(MENU.includes(path) ? [path] : []);
    expect(markup(header)).toBe(expected);
  }, 15000);

  test('Ayuda ya no lleva su cabecera antigua y su «Iniciar sesión» abre el acceso allí mismo', async () => {
    const user = userEvent.setup();
    const header = await pageHeader('/ayuda');
    expect(document.querySelector('.hlp-site-header')).toBeNull();
    await user.click(within(header).getByRole('link', { name: /Iniciar sesión/ }));
    expect(await screen.findByRole('dialog', { name: 'Entra en Uonify' }, { timeout: 5000 })).toBeInTheDocument();
    await settle();
  });
});
