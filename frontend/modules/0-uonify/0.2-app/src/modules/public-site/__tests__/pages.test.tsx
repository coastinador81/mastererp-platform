import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { PageHeader } from '../components/common/PageHeader';
import { ComoFuncionaPage } from '../components/como-funciona/ComoFuncionaPage';
import { LegalPage } from '../components/legal/LegalPage';
import { LegalMarkdown } from '../components/legal/LegalMarkdown';
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
    // Pie global (09-11-2026): el mismo en todas las páginas, también en las interiores.
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getAllByRole('link').map(link => link.textContent)).toEqual(['Partners', 'Clientes', 'Términos y condiciones', 'Ayuda']);
    expect(within(footer).getByRole('button', { name: 'Idioma' })).toHaveAttribute('aria-haspopup', 'dialog');
    // Marco + productos, juego, galería, Administración (ERP) y la hoja rica (con la vista previa del cliente).
    expect(document.head.querySelectorAll('style[data-uon-view-style="producto"]')).toHaveLength(6);
  });

  test('a la derecha, como en la portada: «Iniciar sesión» y el botón de servicios', async () => {
    const user = userEvent.setup();
    renderPage(<ProductosPage />, '/productos');
    const actions = document.querySelector<HTMLElement>('.header .header-actions')!;
    expect(within(actions).getByRole('link', { name: /Iniciar sesión/ })).toBeInTheDocument();
    const trigger = within(actions).getByRole('button', { name: 'Herramientas de Uonify' });
    await user.click(trigger);
    const panel = document.getElementById('tools-panel')!;
    // El mismo panel que la portada, con el primero enfocado. Sin sesión, los 10 servicios son
    // botones que abren «Iniciar sesión»; el único enlace es «Conocer Uonify».
    expect(within(panel).getByRole('button', { name: 'Producto' })).toHaveFocus();
    expect(within(panel).getAllByRole('button')).toHaveLength(10);
    expect(within(panel).getAllByRole('link')).toHaveLength(1);
    expect(within(panel).getByRole('link', { name: 'Conocer Uonify' })).toHaveAttribute('href', '/productos');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  test('sin sesión, cada servicio abre «Iniciar sesión» y recuerda cuál; el panel se cierra', async () => {
    const user = userEvent.setup();
    const { router } = renderPage(<ProductosPage />, '/productos');
    const trigger = screen.getByRole('button', { name: 'Herramientas de Uonify' });
    await user.click(trigger);
    await user.click(within(document.getElementById('tools-panel')!).getByRole('button', { name: 'ERP' }));
    expect(openSignIn).toHaveBeenCalledTimes(1);
    expect(openSignIn).toHaveBeenLastCalledWith({ service: 'erp' });
    expect(document.getElementById('tools-panel')).not.toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // El foco vuelve al botón: al cerrar el acceso, auth lo devuelve ahí y no a un servicio oculto.
    expect(trigger).toHaveFocus();
    expect(router.state.location.pathname).toBe('/productos');
    // El Estudio vive en la conversación del espacio: abre el acceso sin servicio pendiente.
    await user.click(trigger);
    await user.click(within(document.getElementById('tools-panel')!).getByRole('button', { name: 'Estudio' }));
    expect(openSignIn).toHaveBeenLastCalledWith({});
  });

  test('con sesión, cada servicio enlaza a su vista del espacio', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    const { router } = renderPage(<ProductosPage />, '/productos');
    const trigger = screen.getByRole('button', { name: 'Herramientas de Uonify' });
    await user.click(trigger);
    const panel = document.getElementById('tools-panel')!;
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).getByRole('link', { name: 'ERP' })).toHaveAttribute('href', '/espacio?service=erp');
    expect(within(panel).getByRole('link', { name: 'Producto' })).toHaveAttribute('href', '/espacio?service=producto');
    expect(within(panel).getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/espacio');
    expect(within(panel).getAllByRole('link')).toHaveLength(11);
    await user.click(within(panel).getByRole('link', { name: 'ERP' }));
    expect(openSignIn).not.toHaveBeenCalled();
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/espacio?service=erp');
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

describe('cabecera de las páginas públicas', () => {
  test('las interiores marcan su página y prerenderizan el botón de servicios; con noJs no se pinta sin JS', () => {
    renderPage(<SobreUonifyPage />, '/sobre-uonify');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect([...nav.querySelectorAll('[aria-current="page"]')].map(link => link.textContent)).toEqual(['Sobre Uonify']);
    const markup = (noJs: boolean) => renderToStaticMarkup(<MemoryRouter><PageHeader current="precios" loginLabel="Tu espacio Uonify" noJs={noJs} /></MemoryRouter>);
    expect(markup(false)).toMatch(/<button[^>]*class="tools-trigger"/);
    expect(markup(true)).not.toMatch(/<button\b/);
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

  test('con sesión, «Volver a Uonify →» y el acceso de la cabecera llevan al espacio', () => {
    authState.status = 'ready';
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Términos y condiciones');
    expect(screen.getByRole('link', { name: 'Volver a Uonify →' })).toHaveAttribute('href', '/espacio');
    expect(screen.getByRole('link', { name: /Volver a mi espacio/ })).toHaveAttribute('href', '/espacio');
  });

  test('llevan la cabecera de las páginas públicas, sin página actual y con su propia hoja', () => {
    renderPage(<LegalPage doc="privacidad" />, '/privacidad');
    const header = document.querySelector<HTMLElement>('header.header.header--rows')!;
    const nav = within(header).getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    expect(nav.querySelector('[aria-current]')).toBeNull();
    // Con JS, el botón de servicios sí está (sin JS, no: ver la prueba siguiente).
    expect(within(header).getByRole('button', { name: 'Herramientas de Uonify' })).toBeInTheDocument();
    expect(header.querySelector('.header-actions')).not.toHaveClass('header-actions--no-js');
    expect(document.head.querySelectorAll('style[data-uon-view-style="page-header"]')).toHaveLength(1);
    // «Saltar al contenido» lleva al documento legal.
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute('href', '#contenido');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido');
  });

  test.each(['terminos', 'privacidad'] as const)('sin JS (HTML prerenderizado), /%s no lleva ningún <button>: la cabecera, solo enlaces', doc => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/${doc}`]}><LegalPage doc={doc} /></MemoryRouter>);
    expect(html).not.toMatch(/<button\b/);
    const header = new DOMParser().parseFromString(html, 'text/html').querySelector('header.header.header--rows');
    expect(header?.querySelectorAll('nav[aria-label="Navegación principal"] a')).toHaveLength(10);
    expect(header?.querySelector('.tools-trigger, #tools-panel')).toBeNull();
    expect(header?.querySelector('a.login-link')?.getAttribute('href')).toBe('/#composer');
    // Su fila guarda el alto del botón: la cabecera mide lo mismo con y sin JS.
    expect(header?.querySelector('.header-actions')?.classList.contains('header-actions--no-js')).toBe(true);
  });

  test('Privacidad: sin marcadores, con la barra de pestañas común y la pestaña Privacidad activa', () => {
    renderPage(<LegalPage doc="privacidad" />, '/privacidad');
    expect(document.body.innerHTML).not.toMatch(/\{\{|\}\}/);
    const tabs = document.querySelector('.legal-tabs');
    expect(tabs?.textContent).toContain('Términos y condiciones');
    expect(tabs?.textContent).toContain('Cookies');
    expect(document.querySelector('[data-tab="privacidad"]')).toHaveAttribute('aria-current', 'page');
    expect(document.getElementById('panel-privacidad')).not.toBeNull();
  });

  test('Condiciones: sin marcadores, reúne el contrato en paneles con pestañas y anclas namespaceadas', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(document.body.innerHTML).not.toMatch(/\{\{|\}\}/);
    for (const id of ['panel-terminos', 'panel-aviso-legal', 'panel-cookies', 'panel-dpa', 'panel-propiedad-intelectual']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    // La pestaña Privacidad enlaza a su propia página; las anclas se namespacean por panel.
    expect(document.querySelector('[data-tab="privacidad"]')).toHaveAttribute('href', '/privacidad');
    expect(document.querySelector('#panel-dpa [id^="dpa-"]')).not.toBeNull();
  });

  test('con JS, un enlace a /terminos#panel-… abre esa pestaña, no la primera', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos#panel-aviso-legal');
    expect(document.getElementById('panel-aviso-legal')?.className).toContain('is-shown');
    expect(document.getElementById('panel-terminos')?.className).not.toContain('is-shown');
    expect(document.querySelector('[data-tab="aviso-legal"]')).toHaveAttribute('aria-current', 'page');
  });

  test('un ancla de apartado (#dpa-…) también abre su pestaña', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos#dpa-medidas');
    expect(document.getElementById('panel-dpa')?.className).toContain('is-shown');
  });

  test('/privacidad marca una sola pestaña activa (la de Privacidad)', () => {
    renderPage(<LegalPage doc="privacidad" />, '/privacidad');
    const actives = document.querySelectorAll('.legal-tabs a.is-active');
    expect(actives).toHaveLength(1);
    expect(actives[0]).toHaveAttribute('data-tab', 'privacidad');
  });

  test('el título de cada panel es un encabezado (h2) y las secciones quedan por debajo (h3)', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Términos y condiciones');
    const panelTitles = [...document.querySelectorAll('.tab-panel h2.panel-title')].map(h => h.textContent);
    expect(panelTitles).toContain('Aviso legal');
    expect(panelTitles).toContain('Política de cookies');
    // Dentro de un panel, las secciones «##» bajan a h3 (no h2) para no competir con el título.
    const dpa = document.getElementById('panel-dpa');
    expect(dpa?.querySelector('h3')).not.toBeNull();
    expect(dpa?.querySelector('h2:not(.panel-title)')).toBeNull();
  });

  test('las pestañas nuevas (Tus datos, Transparencia de la IA, Seguridad) están en la barra y en /terminos', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    const tabs = document.querySelector('.legal-tabs');
    for (const label of ['Tus datos', 'Transparencia de la IA', 'Seguridad']) expect(tabs?.textContent).toContain(label);
    for (const id of ['panel-tus-datos', 'panel-transparencia-ia', 'panel-seguridad']) expect(document.getElementById(id)).not.toBeNull();
  });

  test('la Lista de proveedores va DENTRO de la pestaña del DPA (Anexo III), no como pestaña propia', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    const dpa = document.getElementById('panel-dpa');
    expect(dpa?.textContent).toContain('Lista de proveedores');
    expect(dpa?.textContent).toContain('Amazon Web Services');
    expect(document.querySelector('[data-tab="lista-proveedores"]')).toBeNull();
  });

  test('las marcas nuevas se rellenan (DataRep, Amazon SES, caducidad del security.txt)', () => {
    renderPage(<LegalPage doc="terminos" />, '/terminos');
    expect(document.getElementById('panel-aviso-legal')?.textContent).toContain('DataRep');
    expect(document.getElementById('panel-dpa')?.textContent).toContain('Amazon SES');
    expect(document.getElementById('panel-seguridad')?.textContent).toContain('2027-11-09');
  });
});

describe('renderizador de los textos legales', () => {
  test('listas numeradas → <ol> (no un párrafo pegado)', () => {
    const { container } = render(<LegalMarkdown source={'1. Uno\n2. Dos\n3. Tres'} />);
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.querySelectorAll(':scope > li')).toHaveLength(3);
  });

  test('viñetas anidadas bajo un número → <ul> dentro del <li>', () => {
    const { container } = render(<LegalMarkdown source={'1. **Cifrado.**\n   - En tránsito.\n   - En reposo.\n2. **Acceso.**'} />);
    const ol = container.querySelector('ol');
    expect(ol?.querySelectorAll(':scope > li')).toHaveLength(2);
    expect(ol?.querySelector(':scope > li ul')?.querySelectorAll('li')).toHaveLength(2);
  });

  test('«<br>» se renderiza como salto de línea, no como texto literal', () => {
    const { container } = render(<LegalMarkdown source={'Incluye:<br>· uno<br>· dos'} />);
    expect(container.querySelectorAll('br').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('<br>');
  });

  test('`código` → <code> (sin comillas invertidas a la vista)', () => {
    const { container } = render(<LegalMarkdown source={'La cookie `__stripe_mid` dura un año.'} />);
    expect(container.querySelector('code')?.textContent).toBe('__stripe_mid');
    expect(container.textContent).not.toContain('`');
  });

  test('`código` dentro de *cursiva* también se renderiza (sin comilla a la vista)', () => {
    const { container } = render(<LegalMarkdown source={'*Identificador `estudio-ia` guardado.*'} />);
    expect(container.querySelector('em code')?.textContent).toBe('estudio-ia');
    expect(container.textContent).not.toContain('`');
  });

  test('bloque de código con ``` → <pre><code> (sin comillas invertidas a la vista)', () => {
    const src = 'Antes.\n\n```\nContact: mailto:x@y.com\nExpires: 2027-11-09T00:00:00Z\n```\n\nDespués.';
    const { container } = render(<LegalMarkdown source={src} />);
    const pre = container.querySelector('pre code');
    expect(pre?.textContent).toContain('Contact: mailto:x@y.com');
    expect(pre?.textContent).toContain('Expires: 2027-11-09T00:00:00Z');
    expect(container.textContent).not.toContain('`');
  });

  test('headingOffset baja el nivel de los títulos (## → h3)', () => {
    const { container } = render(<LegalMarkdown source={'## Apartado\n\nTexto.'} headingOffset={1} />);
    expect(container.querySelector('h3')?.textContent).toBe('Apartado');
    expect(container.querySelector('h2')).toBeNull();
  });
});
