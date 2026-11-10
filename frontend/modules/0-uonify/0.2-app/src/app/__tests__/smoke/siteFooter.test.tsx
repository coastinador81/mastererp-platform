import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { HELP_PUBLIC_PATHS } from '@/modules/help';
import { PUBLIC_PATHS } from '@/modules/public-site';
import { renderApp, settle, setupSmokeServer } from './harness';

// jsdom no tiene WebGL: <model-viewer> se queda sin definir, como antes de cargar.
vi.mock('@google/model-viewer', () => ({}));

setupSmokeServer();

/**
 * Todas las páginas públicas (las que se prerenderizan): la portada, las 10 interiores, el
 * centro legal (/terminos y /privacidad), Ayuda y cada uno de sus artículos.
 */
const FOOTER_PATHS: readonly string[] = [...new Set([...PUBLIC_PATHS, ...HELP_PUBLIC_PATHS])];

/** Pinta la ruta con la app completa y devuelve el marcado de su pie (sin espacios entre etiquetas). */
async function footerMarkup(path: string): Promise<string> {
  renderApp(path);
  await waitFor(() => expect(document.querySelector('footer.site-footer')).not.toBeNull(), { timeout: 5000 });
  await settle();
  const footers = document.querySelectorAll('footer.site-footer');
  expect(footers).toHaveLength(1);
  // Sus tokens no dependen de los :root que redefinen las hojas de cada vista.
  expect(footers[0]).toHaveClass('uon-token-scope');
  return footers[0].outerHTML.replace(/>\s+</g, '><').trim();
}

/** El pie de la portada, la referencia (se pinta una vez, en la primera prueba que lo pide). */
let homeFooter: string | undefined;
async function referenceFooter(): Promise<string> {
  if (homeFooter === undefined) {
    homeFooter = await footerMarkup('/');
    cleanup();
  }
  return homeFooter;
}

describe('pie global en la aplicación completa', () => {
  test('recorre todas las páginas públicas: las 10 interiores, el centro legal, Ayuda y sus artículos', () => {
    for (const path of ['/productos', '/como-funciona', '/lo-que-puedes-hacer', '/partners', '/clientes', '/precios',
      '/seguridad', '/para-empresas', '/sobre-uonify', '/novedades', '/terminos', '/privacidad', '/ayuda']) {
      expect(FOOTER_PATHS).toContain(path);
    }
    expect(FOOTER_PATHS.filter(path => path.startsWith('/ayuda/')).length).toBeGreaterThan(0);
  });

  test.each(FOOTER_PATHS)('%s lleva el mismo pie que la portada', async path => {
    const expected = await referenceFooter();
    expect(expected).toContain('Términos y condiciones');
    expect(await footerMarkup(path)).toBe(expected);
  });

  test('Ayuda conserva la nota de marcas justo encima del pie, fuera de él y en su propia región', async () => {
    renderApp('/ayuda');
    const note = await screen.findByText(/son marcas de Google LLC/, {}, { timeout: 5000 });
    const footer = document.querySelector('footer.site-footer');
    expect(note).toBe(screen.getByRole('complementary', { name: 'Marcas de terceros' }));
    expect(note.nextElementSibling).toBe(footer);
    expect(footer).not.toContainElement(note);
    // La cita literal de Amazon va en inglés (WCAG 3.1.2, idioma de las partes).
    expect(within(note).getByText(/^Amazon and all related marks/)).toHaveAttribute('lang', 'en');
    await settle();
  });
});
