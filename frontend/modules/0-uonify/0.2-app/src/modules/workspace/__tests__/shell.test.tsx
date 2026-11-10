import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { queryClient } from '@/shared/api/queryClient';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { routes } from '../routes';
import { renderWorkspace, resetStores } from './harness';

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('../components/authBridge', () => ({
  AuthDialogs: () => null,
  signOut: auth.signOut,
  requirePrompt: (_text: string, run: () => void) => {
    run();
    return Promise.resolve();
  },
  takePendingPrompt: () => '',
  useSession: () => ({ status: 'ready', user: { email: 'ana@uonify.com' }, profile: null }),
  useAccountSummary: () => ({ name: 'Ana', email: 'ana@uonify.com', initial: 'A', planLabel: 'Plan Pro' }),
}));

// La ayuda y la campana son de sus módulos: aquí basta con saber dónde se pintan.
vi.mock('../components/moduleBridge', () => ({
  HelpButton: () => <button type="button" id="help-button">Ayuda</button>,
  NotificationsBell: () => <button type="button" id="notifications-bell">Avisos</button>,
  settingsPath: (section = 'cuenta') => `/espacio/configuracion/${section}`,
}));

vi.mock('../api/assistant', () => ({
  ASSISTANT_ENDPOINTS: { USAGE: '/ai/usage', MESSAGES: '/assistant/messages' },
  getUsage: vi.fn(() => Promise.resolve({ plan: 'Free', limits: [{ label: 'Límite de 5 horas', usedPercent: 6, reset: '2 h 46 min' }] })),
  postAssistantMessage: vi.fn(() => Promise.resolve({ id: 'm1', threadId: 't', receivedAt: '', usage: { plan: 'Free', limits: [{ label: 'Límite de 5 horas', usedPercent: 7, reset: '2 h 40 min' }] } })),
}));

beforeEach(() => {
  resetStores('/espacio');
  auth.signOut.mockClear();
});

/** El espacio con la página de Configuración que declara el módulo settings. */
function renderWithSettings(path = '/espacio') {
  const settings: RouteObject = { path: 'configuracion/:section?', element: <h1>Configuración</h1> };
  const tree = routes.map(route => (route.id === 'workspace' ? ({ ...route, children: [settings, ...(route.children ?? [])] } as RouteObject) : route));
  const router = createMemoryRouter(tree, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

// Puerto de tests/chat-panel-layout y workspace-routing (marcado del espacio).
describe('marco del espacio', () => {
  it('arriba a la derecha, de derecha a izquierda: cuenta, servicios, ayuda, avisos y conversación', () => {
    const { container } = renderWorkspace();
    const corner = container.querySelector('.topbar-right') as HTMLElement;
    const ids = [...corner.querySelectorAll('[id]')].map(element => element.id);
    const order = ['chat-panel-toggle', 'notifications-bell', 'help-button', 'services-trigger', 'account-button'].map(id => ids.indexOf(id));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(container.querySelector('#account-menu')).toHaveAttribute('hidden');
    expect(container.querySelector('#chat-panel-toggle')).toHaveAttribute('aria-controls', 'conversation-dock');
    // En móvil, el logotipo cede su sitio al isotipo (lo decide la hoja de estilos).
    expect(container.querySelector('.workspace-brand-compact')).toHaveAttribute('src', '/assets/brands/uonify-isotipo-3d.webp');
    // La cuenta salió del compositor; solo queda «Hilos» (decisión del dueño: sin «Proyectos»).
    const composer = container.querySelector('#composer') as HTMLElement;
    expect(within(composer).queryByText('Cerrar sesión')).toBeNull();
    expect(within(composer).getByRole('button', { name: 'Hilos' })).toHaveAttribute('data-tooltip', 'Hilos');
    expect(screen.queryByRole('button', { name: 'Proyectos' })).toBeNull();
    expect(container.querySelector('#project-dialog')).toBeNull();
  });

  it('el panel de conversación tiene su borde redimensionable y «Nueva conversación»', () => {
    const { container } = renderWorkspace();
    expect(container.querySelector('#chat-panel-sash')).toHaveAttribute('role', 'separator');
    expect(container.querySelector('#chat-panel-sash')).toHaveAttribute('aria-orientation', 'vertical');
    expect(container.querySelector('#conversation-new')).toHaveAttribute('aria-label', 'Nueva conversación');
    expect(container.querySelector('#chat-panel-fab')).toBeInTheDocument();
    expect(container.querySelector('#conversation-live')).toHaveAttribute('aria-live', 'polite');
  });

  it('el logotipo empieza de nuevo: lienzo en blanco', () => {
    useWorkspaceStore.getState().createThread({ title: 'Hola', service: 'analitica', view: 'default' });
    const { router } = renderWorkspace('/espacio/analitica');
    expect(screen.getByRole('heading', { level: 1, name: 'Analítica' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Uonify: empezar de nuevo' }));
    expect(router.state.location.pathname).toBe('/espacio');
    expect(useWorkspaceStore.getState().activeThreadId).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hazlo posible.');
  });

  it('el menú de cuenta: «Configuración» lleva a /espacio/configuracion/cuenta y «Cerrar sesión» está dentro', () => {
    const { router, container } = renderWithSettings();
    const button = screen.getByRole('button', { name: /Cuenta:/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('region', { name: 'Cuenta' });
    expect(within(menu).getByText('Plan Pro')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Configuración' }));
    expect(router.state.location.pathname).toBe('/espacio/configuracion/cuenta');
    expect(menu).toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    // La página ocupa el ancho bajo la cabecera en barra, sin conversación ni compositor.
    expect(container.querySelector('.workspace-column')).toHaveClass('is-page');
    expect(container.querySelector('#workspace')).toHaveClass('is-page');
    expect(container.querySelector('#topbar-module')).toHaveTextContent('Configuración');
    expect(container.querySelector('#composer')).toBeNull();
    expect(container.querySelector('#workspace')).toHaveFocus();
    fireEvent.click(button);
    fireEvent.click(within(menu).getByRole('button', { name: 'Cerrar sesión' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('con un hilo abierto, Configuración sigue siendo una página (no la tapa la conversación)', () => {
    useWorkspaceStore.getState().createThread({ title: 'Hola', service: null, view: 'default' });
    const { container } = renderWithSettings('/espacio/configuracion/uso');
    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(container.querySelector('.workspace-column')).not.toHaveClass('is-chat');
    expect(container.querySelector('#conversation-dock')).toHaveAttribute('hidden');
  });

  it('el menú de servicios abre cada servicio y Escape lo cierra devolviendo el foco', () => {
    const { router } = renderWorkspace();
    const trigger = screen.getByRole('button', { name: 'Abrir servicios de Uonify' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('region', { name: 'Servicios de Uonify' });
    // Dueño (10-11-2026): todos los servicios activos a la vista, sin desplegable ni «Próximamente».
    for (const name of ['Producto', 'Estudio', 'ERP', 'Nexus', 'Analítica', 'Captura y auditoría', 'Agentes', 'Academy', 'Logística', 'Fábrica y proveedores']) {
      expect(within(menu).getByRole('button', { name })).toBeEnabled();
    }
    expect(within(menu).queryByRole('button', { name: /Más servicios/ })).not.toBeInTheDocument();
    expect(within(menu).queryByText(/próximamente/i)).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: /Conocer Uonify/ })).toHaveAttribute('target', '_blank');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu).toHaveAttribute('hidden');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(within(menu).getByRole('button', { name: 'Nexus' }));
    expect(router.state.location.pathname).toBe('/espacio/nexus');
    fireEvent.click(screen.getByRole('button', { name: /Amazon/ }));
    expect(router.state.location.pathname).toBe('/espacio/nexus/amazon');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con Amazon' }));
    expect(screen.getByText('La autorización de Amazon se completará al vincular una cuenta de Uonify.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Continuar con Amazon' })).toBeDisabled();
  });
});

// Pie global de Uonify (módulo public-site): el dueño pide que nunca se oculte, con o sin sesión.
describe('pie global', () => {
  /** El único pie de la página, al final de la columna, fuera de la vista y de la conversación. */
  function footerOf(container: HTMLElement) {
    const column = container.querySelector('.workspace-column') as HTMLElement;
    const footer = screen.getByRole('contentinfo');
    expect(container.querySelectorAll('footer.site-footer')).toHaveLength(1);
    expect(column.lastElementChild).toHaveClass('workspace-footer');
    expect(column.lastElementChild).toContainElement(footer);
    expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).not.toContainElement(footer);
    expect(container.querySelector('#conversation-dock')).not.toContainElement(footer);
    return { column, footer, wrapper: column.lastElementChild as HTMLElement };
  }

  it('cierra el marco en el lienzo, en un servicio y en Configuración', () => {
    const home = renderWorkspace();
    const { footer } = footerOf(home.container);
    expect(within(footer).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Partners', '/partners'], ['Clientes', '/clientes'], ['Términos y condiciones', '/terminos'], ['Ayuda', '/ayuda'],
    ]);
    expect(within(footer).getByRole('button', { name: 'Idioma' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(footer).not.toHaveTextContent(/Próximamente|En preparación|En desarrollo/);
    home.unmount();
    const service = renderWorkspace('/espacio/analitica');
    expect(footerOf(service.container).column).toHaveClass('is-module');
    service.unmount();
    const page = renderWithSettings('/espacio/configuracion/cuenta');
    expect(footerOf(page.container).column).toHaveClass('is-page');
  });

  it('queda inerte con el panel de hilos abierto, como el resto del espacio', () => {
    const { container } = renderWorkspace();
    const { wrapper } = footerOf(container);
    expect(wrapper).not.toHaveAttribute('inert');
    fireEvent.click(within(container.querySelector('#composer') as HTMLElement).getByRole('button', { name: 'Hilos' }));
    expect(wrapper).toHaveAttribute('inert');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(wrapper).not.toHaveAttribute('inert');
  });

  it('el globo abre «Idioma y accesibilidad» y Escape lo cierra devolviendo el foco al globo', () => {
    const { container } = renderWorkspace();
    const globe = within(footerOf(container).footer).getByRole('button', { name: 'Idioma' });
    fireEvent.click(globe);
    const menu = screen.getByRole('dialog', { name: 'Idioma y accesibilidad' });
    expect(within(menu).getByRole('radio', { name: 'Español' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Idioma y accesibilidad' })).toBeNull();
    expect(globe).toHaveFocus();
  });

  it('los menús del compositor cuentan lo visible hasta el pie: el de modelo no se abre hacia él', () => {
    const { container } = renderWorkspace();
    const box = (top: number, bottom: number, left: number, right: number) =>
      ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const menu = container.querySelector('.composer-model-menu') as HTMLElement;
    vi.spyOn(container.querySelector('#composer') as HTMLElement, 'getBoundingClientRect').mockReturnValue(box(300, 420, 100, 700));
    vi.spyOn(container.querySelector('.composer-ai-picker') as HTMLElement, 'getBoundingClientRect').mockReturnValue(box(380, 412, 400, 600));
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(box(0, 0, 400, 700));
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 588 });
    // Encima caben 380 − 84 = 296 px. Hasta el borde de la ventana cabrían más debajo (se abriría
    // hacia el pie); hasta el pie de 57 px, menos: se abre encima.
    expect(window.innerHeight - 412 - 30).toBeGreaterThan(296);
    expect(window.innerHeight - 57 - 412 - 30).toBeLessThan(296);
    vi.spyOn(container.querySelector('.workspace-footer') as HTMLElement, 'getBoundingClientRect')
      .mockReturnValue(box(window.innerHeight - 57, window.innerHeight, 0, window.innerWidth));
    fireEvent.click(screen.getByRole('button', { name: /^Modelo:/ }));
    expect(menu).not.toHaveAttribute('hidden');
    expect(menu).not.toHaveClass('composer-popover-below');
    expect(menu.style.maxHeight).toBe('296px');
  });

  it('escribe en la columna el alto real del pie y lo sigue cuando cambia de filas', () => {
    const observed = new Map<Element, () => void>();
    class FakeObserver {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(target: Element) { observed.set(target, this.callback); }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    let height = 57;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const tall = this.classList.contains('workspace-footer') ? height : 0;
      return { top: 0, bottom: tall, left: 0, right: 0, width: 0, height: tall, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      const { container } = renderWorkspace();
      const { column, wrapper } = footerOf(container);
      expect(column.style.getPropertyValue('--workspace-footer-height')).toBe('57px');
      // Dos filas en móvil: los paneles sobre el compositor descuentan lo que mide de verdad.
      height = 89;
      act(() => observed.get(wrapper)?.());
      expect(column.style.getPropertyValue('--workspace-footer-height')).toBe('89px');
    } finally {
      rect.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('aplica al entrar «Más contraste» y «Reducir movimiento» guardados en la pestaña (lo hace el pie)', () => {
    sessionStorage.setItem('uonify-preferences', JSON.stringify({ contrast: true, reduceMotion: true }));
    try {
      renderWorkspace();
      expect(document.documentElement.dataset).toMatchObject({ moreContrast: 'true', reduceMotion: 'true' });
    } finally {
      delete document.documentElement.dataset.moreContrast;
      delete document.documentElement.dataset.reduceMotion;
    }
  });

  it('en móvil, el botón «Conversación» se oculta mientras el menú de servicios está abierto', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 900px)', addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      const { container } = renderWorkspace('/espacio/analitica');
      const fab = container.querySelector('#chat-panel-fab') as HTMLElement;
      expect(fab).not.toHaveAttribute('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Abrir servicios de Uonify' }));
      expect(screen.getByRole('region', { name: 'Servicios de Uonify' })).not.toHaveAttribute('hidden');
      expect(fab).toHaveAttribute('hidden');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(fab).not.toHaveAttribute('hidden');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('servicios y panel de conversación', () => {
  it('?service= abre ese servicio (enlace profundo del PROTO)', () => {
    const { router } = renderWorkspace('/espacio?service=nexus');
    expect(router.state.location.pathname).toBe('/espacio/nexus');
    expect(screen.getByRole('heading', { level: 1, name: 'Nexus' })).toBeInTheDocument();
  });

  it('con un servicio abierto la conversación va a la derecha y se oculta desde la cabecera', () => {
    const { container } = renderWorkspace('/espacio/analitica');
    const column = container.querySelector('.workspace-column') as HTMLElement;
    expect(column).toHaveClass('is-module');
    expect(screen.getByText('Pídele a Uony lo que necesites en Analítica.')).toBeInTheDocument();
    const toggle = container.querySelector('#chat-panel-toggle') as HTMLElement;
    expect(toggle).not.toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(container.querySelector('#conversation-dock') as HTMLElement).getByRole('button', { name: 'Ocultar conversación' }));
    expect(column).toHaveClass('is-chat-hidden');
    expect(container.querySelector('#conversation-dock')).toHaveAttribute('hidden');
    expect(toggle).toHaveAccessibleName('Mostrar conversación');
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    expect(column).not.toHaveClass('is-chat-hidden');
    expect(screen.getByLabelText('Escribe a Uony')).toHaveFocus();
    expect(useWorkspaceStore.getState().chatPanelCollapsed).toBe(false);
  });
});

describe('panel «Hilos»', () => {
  it('se abre con Hilos, se cierra con Escape y devuelve el foco', () => {
    const { container } = renderWorkspace();
    const threads = within(container.querySelector('#composer') as HTMLElement).getByRole('button', { name: 'Hilos' });
    fireEvent.click(threads);
    const drawer = screen.getByRole('dialog', { name: 'Hilos' });
    expect(drawer).not.toHaveAttribute('hidden');
    expect(within(drawer).getByRole('button', { name: 'Nuevo hilo' })).toHaveFocus();
    expect(container.querySelector('#workspace')).toHaveAttribute('inert');
    expect(within(drawer).getByText('Aún no hay hilos. Escribe un mensaje para empezar.')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(drawer).toHaveAttribute('hidden');
    expect(threads).toHaveFocus();
  });

  it('ofrece proyectos y conserva los hilos recientes', () => {
    const store = useWorkspaceStore.getState();
    store.createThread({ title: 'Primero', service: null, view: 'default' });
    // Un servicio con la vista genérica de este módulo (ERP la pinta el módulo erp).
    store.createThread({ title: 'Segundo', service: 'analitica', view: 'default' });
    store.setActiveThread(null);
    renderWorkspace();
    fireEvent.click(screen.getAllByRole('button', { name: 'Hilos' })[0]);
    const drawer = screen.getByRole('dialog', { name: 'Hilos' });
    expect(within(drawer).getByRole('button', { name: 'Nuevo proyecto' })).toBeInTheDocument();
    expect(within(drawer).getByText('Proyectos')).toBeInTheDocument();
    const list = within(drawer).getAllByRole('button').filter(button => button.classList.contains('thread-button'));
    expect(list.map(button => button.textContent)).toEqual(['Segundo', 'Primero']);
    fireEvent.click(list[0]);
    expect(drawer).toHaveAttribute('hidden');
    expect(useWorkspaceStore.getState().activeThreadId).toBe(useWorkspaceStore.getState().threads[1].id);
  });
});

describe('conversación desde el inicio', () => {
  it('enviar desde el lienzo abre la conversación y Uony abre el servicio pedido', async () => {
    vi.useFakeTimers();
    try {
      const { router, container } = renderWorkspace();
      const text = screen.getByLabelText('Escribe a Uony');
      // Un servicio con la vista genérica de este módulo (ERP la pinta el módulo erp).
      fireEvent.change(text, { target: { value: 'Prepara un informe de márgenes' } });
      fireEvent.keyDown(text, { key: 'Enter' });
      expect(container.querySelector('.workspace-column')).toHaveClass('is-chat');
      expect(screen.getByText('Revisando tu petición…')).toBeInTheDocument();
      expect(container.querySelector('.composer-send')).toHaveAttribute('data-tooltip', 'Uony está respondiendo…');
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(router.state.location.pathname).toBe('/espacio/analitica');
      expect(screen.getByText('He abierto Analítica para revisar tus datos.', { selector: '.message' })).toBeInTheDocument();
      // En móvil, el botón flotante enseña la última respuesta.
      expect(container.querySelector('#chat-panel-fab-text')).toHaveTextContent('He abierto Analítica para revisar tus datos.');
      expect(container.querySelector('.workspace-column')).toHaveClass('is-module');
      expect(screen.getByLabelText('Escribe a Uony')).toHaveValue('');
    } finally {
      vi.useRealTimers();
    }
  });
});
