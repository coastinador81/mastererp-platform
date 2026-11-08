import { screen, waitFor, within } from '@testing-library/react';
import { PIM_TAB_LABELS, PIM_TAB_ORDER, type PimTabKey } from '@/shared/pim';
import {
  collectConsoleErrors,
  expectNoCrashScreen,
  renderApp,
  settle,
  seedSignedInSession,
  setupSmokeServer,
  unhandledApiCalls,
} from './harness';

setupSmokeServer();
const consoleErrors = collectConsoleErrors();
seedSignedInSession();

const SAMPLE_SKU = 'UON-KIT-01';
const SAMPLE_NAME = /^Make It Possible by Uonify/;

// Un título propio de cada pestaña (textos del prototipo) para saber que se ha pintado entera.
const BASE_TABS = PIM_TAB_ORDER.filter(tab => tab !== 'incidencias');
const TAB_HEADINGS: Record<Exclude<PimTabKey, 'incidencias'>, string> = {
  atributos: 'Atributos del Producto',
  auditoria: 'Auditoría IA Inteligente',
  descripciones: 'Descripción Larga',
  gpsr: 'Fabricante y persona responsable',
  imagenes: 'Galería de Imágenes (8)',
  modelos3d: 'Modelos 3D',
  video: 'Vídeo',
  aplus: 'Contenido A+',
};

/** Espera a que la pestaña esté montada (fuera del «Cargando…» de la ficha). */
async function findMountedTab(tab: PimTabKey): Promise<HTMLElement> {
  let host: HTMLElement | null = null;
  await waitFor(() => {
    host = document.querySelector<HTMLElement>(`#product-pim-host[data-pim-tab="${tab}"]`);
    expect(host).not.toBeNull();
    expect(within(host!).queryByText('Cargando…', { selector: '.product-pim-loading' })).not.toBeInTheDocument();
  }, { timeout: 4000 });
  return host!;
}

describe('servicio Producto', () => {
  test('/espacio/producto: catálogo con el producto de ejemplo', async () => {
    renderApp('/espacio/producto');
    const drawer = await screen.findByRole('complementary', { name: 'Catálogo de productos' });
    expect(await within(drawer).findByText(SAMPLE_NAME, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canales de venta' })).toBeInTheDocument();
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });

  test('/espacio/producto/nuevo: ficha de «Nuevo Producto» con Atributos', async () => {
    renderApp('/espacio/producto/nuevo');
    expect(await screen.findByRole('heading', { level: 1, name: 'Nuevo Producto' }, { timeout: 4000 })).toBeInTheDocument();
    await findMountedTab('atributos');
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });

  test.each(BASE_TABS.map(tab => [tab, PIM_TAB_LABELS[tab]] as const))('ficha del ejemplo, pestaña %s', async (tab, label) => {
    const path = tab === 'atributos' ? `/espacio/producto/${SAMPLE_SKU}` : `/espacio/producto/${SAMPLE_SKU}/${tab}`;
    const { router } = renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: SAMPLE_NAME }, { timeout: 4000 })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Contenido de la ficha' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(BASE_TABS.length);
    expect(within(tabs).queryByRole('tab', { name: /Incidencias/ })).not.toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    const host = await findMountedTab(tab);
    expect(within(host).getAllByRole('heading', { name: TAB_HEADINGS[tab] }).length).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe(path);
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });
});
