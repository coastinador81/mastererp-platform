import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComoFuncionaPage } from '../components/como-funciona/ComoFuncionaPage';
import { LegalPage } from '../components/legal/LegalPage';
import { NovedadesPage } from '../components/novedades/NovedadesPage';
import { ParaEmpresasPage } from '../components/para-empresas/ParaEmpresasPage';
import { ProductosPage } from '../components/productos/ProductosPage';
import { SobreUonifyPage } from '../components/sobre-uonify/SobreUonifyPage';
import { DEMO_TOAST_MS } from '../components/common/useDemoToast';
import { authState, openSignIn } from './authMock';
import { renderPage } from './renderPage';

vi.mock('@/modules/auth', async () => (await import('./authMock')).authMock);
// El visor 3D real (three.js) no hace falta en jsdom: el póster basta.
vi.mock('@google/model-viewer', () => ({}));

beforeEach(() => {
  authState.status = 'signed-out';
  openSignIn.mockClear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('Productos', () => {
  test('cabecera con la página actual, clase del body y el pie global de la Home', () => {
    renderPage(<ProductosPage />, '/productos');
    expect(document.title).toBe('Servicios — Uonify');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Servicios' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Cómo funciona' })).toHaveAttribute('href', '/como-funciona');
    // Regla del dueño (08-11-2026): un solo pie, el de la Home, en todas las páginas públicas.
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Para equipos y marcasCómo funciona UonifyPrivacidadCondicionesPreferencias');
    // Marco + productos, juego, galería, Administración (ERP) y la hoja rica (con la vista previa del cliente).
    expect(document.head.querySelectorAll('style[data-uon-view-style="producto"]')).toHaveLength(6);
  });

  test('«Iniciar sesión» abre el acceso sin salir de la página', async () => {
    const user = userEvent.setup();
    const { router } = renderPage(<ProductosPage />, '/productos');
    await user.click(screen.getByRole('link', { name: /Iniciar sesión/ }));
    expect(openSignIn).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/productos');
  });

  test('las vistas muestran capturas reales y permiten ampliarlas sin iniciar sesión', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    const attributes = screen.getByRole('tab', { name: 'Ver atributos' });
    attributes.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Ver descripciones' })).toHaveFocus();
    expect(within(screen.getByRole('tabpanel', { name: 'Ver descripciones' })).getByRole('img')).toHaveAttribute('src', '/assets/interface/producto-descripciones.png');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Ver imágenes' })).toHaveAttribute('aria-selected', 'true');
    const trigger = screen.getByRole('button', { name: 'Ampliar interfaz' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Producto · Imágenes' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/assets/interface/producto-imagenes.png');
    expect(within(dialog).getByRole('link', { name: /Abrir imagen a tamaño completo/ })).toHaveAttribute('href', '/assets/interface/producto-imagenes.png');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(openSignIn).not.toHaveBeenCalled();
  });

  test('la galería cambia de imagen con las miniaturas y el teclado', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    const first = screen.getByRole('button', { name: 'Imagen 1 de 7: el juego completo' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    first.focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Imagen 7 de 7: packaging completo' })).toHaveFocus();
    expect(document.querySelector('[data-listing-count]')).toHaveTextContent('7 / 7');
    expect(screen.getByRole('link', { name: 'Abrir todo explicado en la caja a tamaño completo' })).toBeInTheDocument();
  });

  test('las pestañas de la galería muestran el 3D, el A+ y el vídeo', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    await user.click(screen.getByRole('tab', { name: /Recursos 3D/ }));
    expect(document.getElementById('gallery-model')).not.toHaveAttribute('hidden');
    expect(document.getElementById('viewer-status')).toHaveTextContent('Cargando la caja en alta definición…');
    expect(screen.getByRole('button', { name: 'Restablecer vista' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Contenido A+' }));
    expect(document.getElementById('gallery-aplus')).not.toHaveAttribute('hidden');
    expect(document.getElementById('aplus-hd-opening-title')).toHaveTextContent('Todoempiezajugando.');
    await user.click(screen.getByRole('tab', { name: 'Vídeo' }));
    expect(screen.getByLabelText('Vídeo del juego de piezas de Uonify')).toBeInTheDocument();
  });

  test('las escenas de IA responden como Uony y lo anuncian', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    expect(document.getElementById('ai-request')).toHaveTextContent('Revisa la ficha de Make It Possible by Uonify');
    expect(document.querySelector('[data-interface-view="uony-revision"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Prepara su contenido/ }));
    expect(document.getElementById('ai-request')).toHaveTextContent('Prepara una descripción cercana para Make It Possible by Uonify a partir de su ficha.');
    expect(document.querySelector('#ai-result .result-state')).toHaveTextContent('Borrador para revisar');
    await user.click(screen.getByRole('button', { name: 'Más directo' }));
    expect(document.getElementById('description-example')).toHaveTextContent(/^Juego de construcción de madera/);
  });

  test('la landing abre el mismo visor en un diálogo, con galería, vídeo y A+, sin pedir acceso', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    const trigger = screen.getByRole('button', { name: 'Ver vista previa' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Tu ficha para Amazon.es' });
    expect(within(dialog).getByRole('heading', { name: 'Contenido A+' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver vídeo del producto' }));
    expect(dialog.querySelector('.amazon-preview-main video')).toHaveAttribute('controls');
    expect(within(dialog).queryByRole('button', { name: 'Aprobar y publicar' })).not.toBeInTheDocument();
    expect(openSignIn).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('el carrusel se puede pausar', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    await user.click(screen.getByRole('button', { name: 'Pausar movimiento de los productos' }));
    expect(screen.getByRole('button', { name: 'Reanudar movimiento de los productos' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.getElementById('family-track')).toHaveClass('is-paused');
  });
});

describe('Cómo funciona', () => {
  test('las etapas actualizan el panel y el body lleva su clase', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(<ComoFuncionaPage />, '/como-funciona');
    expect(document.body).toHaveClass('how-page');
    await user.click(screen.getByRole('tab', { name: /Coordina/ }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-active-step', 'coordinate');
    expect(panel).toHaveTextContent('4 etapas de preparación');
    expect(panel.querySelector('[data-interface-view="uony-archivos"] img')).toHaveAttribute('src', '/assets/interface/uony-archivos.png');
    unmount();
    expect(document.body).not.toHaveClass('how-page');
  });

  test('las demostraciones avisan con un mensaje que desaparece solo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage(<ComoFuncionaPage />, '/como-funciona');
    await user.click(screen.getByRole('button', { name: /Ver qué conserva el recorrido/ }));
    expect(document.querySelector('.how-toast')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(DEMO_TOAST_MS + 10); });
    expect(document.querySelector('.how-toast')).toBeNull();
    vi.useRealTimers();
  });
});

describe('Para equipos y marcas', () => {
  test('muestra el cliente actual, lo que aporta hoy y el contacto por correo', () => {
    renderPage(<ParaEmpresasPage />, '/para-empresas');
    expect(document.title).toBe('Para equipos y marcas — Uonify');
    // El cliente real (captura del módulo Producto).
    expect(document.querySelector('img[src^="/assets/interface/"]')).toBeInTheDocument();
    // Lo que aporta hoy: piezas verdaderas, sin roles ni permisos inventados.
    expect(screen.getByText('Un catálogo común para todas tus marcas.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Escríbenos a hola@uonify\.com/ })).toHaveAttribute('href', expect.stringMatching(/^mailto:hola@uonify\.com/));
    expect(document.querySelector('.orbit-window,.scale-table,.control-visual,.ecosystem-map,.teams-grid')).toBeNull();
  });
});

describe('Sobre Uonify y Novedades', () => {
  test('Sobre Uonify enlaza cada herramienta con su sección de Productos', () => {
    renderPage(<SobreUonifyPage />, '/sobre-uonify');
    expect(document.title).toBe('Sobre Uonify — Lo que creas tiene muchas posibilidades');
    expect(screen.getByRole('link', { name: /Fábrica y proveedores/ })).toHaveAttribute('href', '/productos#fabrica');
    expect(screen.getByRole('link', { name: /Empieza ahora/ })).toHaveAttribute('href', '/#composer');
  });

  test('Novedades muestra el conjunto mientras llega la animación', () => {
    renderPage(<NovedadesPage />, '/novedades');
    expect(document.body).toHaveClass('news-page');
    expect(screen.getByAltText('Los personajes de Productos, ERP y Agentes en piezas de madera')).toBeInTheDocument();
    // Los controles de postura y reproducción solo aparecen cuando el modelo ha cargado.
    expect(document.querySelector('.kit-controls[aria-label="Explorar el juego de piezas"]')).toHaveAttribute('hidden');
    expect(screen.getByText('La primera pieza de Uonify es tu producto.').closest('details')).toHaveAttribute('open');
  });
});

describe('interfaces actuales en la landing', () => {
  test.each([
    ['/productos', ProductosPage], ['/para-empresas', ParaEmpresasPage],
    ['/como-funciona', ComoFuncionaPage], ['/sobre-uonify', SobreUonifyPage], ['/novedades', NovedadesPage],
  ] as const)('%s retira las pantallas antiguas y conserva capturas ampliables', (path, Page) => {
    renderPage(<Page />, path);
    expect(document.querySelector('.client-preview,.orbit-window,.scale-table,.control-visual,.review-canvas,.writing-document,.purpose-product,.coordinate-board')).toBeNull();
    expect(document.querySelectorAll('img[src^="/assets/interface/"]').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Ampliar/ }).length).toBeGreaterThan(0);
  });
});

describe('páginas legales', () => {
  test('Privacidad y Condiciones se abren sin sesión y vuelven a Uonify', () => {
    renderPage(<LegalPage doc="privacidad" />, '/privacidad');
    expect(document.title).toBe('Privacidad — Uonify');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/^Privacidad en Uonify/);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tu información, bajo tu control.');
    expect(screen.getByRole('link', { name: 'Volver a Uonify →' })).toHaveAttribute('href', '/#composer');
  });

  test('con sesión, «Volver a Uonify» lleva al espacio', () => {
    authState.status = 'ready';
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aviso legal y condiciones.');
    expect(screen.getByRole('link', { name: 'Volver a Uonify' })).toHaveAttribute('href', '/espacio');
  });

  test('Privacidad no deja marcadores sin rellenar y su índice tiene los 17 apartados', () => {
    renderPage(<LegalPage doc="privacidad" />, '/privacidad');
    expect(document.body.innerHTML).not.toMatch(/\{\{|\}\}/);
    expect(document.querySelectorAll('.legal-toc li')).toHaveLength(17);
  });

  test('Condiciones no deja marcadores sin rellenar', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(document.body.innerHTML).not.toMatch(/\{\{|\}\}/);
    expect(document.querySelectorAll('.legal-toc li').length).toBeGreaterThanOrEqual(3);
  });
});
