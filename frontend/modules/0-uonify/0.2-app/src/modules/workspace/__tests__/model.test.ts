import { chatLayout, chatPanelVisible, chatWidthLimits, sashKeyWidth } from '../model/chatPanel';
import { entryRedirect } from '../model/entry';
import { recentThreads } from '../model/navigation';
import { workspacePageOf } from '../model/pages';
import { resolveReply, routePrompt } from '../model/routePrompt';
import { parseWorkspacePath, screenKey, servicePath } from '../model/services';
import { restoreWorkspace, threadTitle, type Thread } from '../model/workspaceState';

// Puertos de tests/workspace-clean-home, workspace-routing, chat-panel-layout y
// composer-threads-grouping del prototipo (la lógica pura del espacio).

describe('reglas de recarga (workspace-clean-home)', () => {
  it('una recarga no restaura el hilo ni la conversación abiertos', () => {
    const state = restoreWith({
      threads: [{ id: 't1', title: 'Amazon', messages: [] }],
      activeThreadId: 't1',
      activeService: 'producto',
      serviceView: 'new-product',
      conversationExpanded: true,
    });
    expect(state.activeThreadId).toBeNull();
    expect(state.conversationExpanded).toBe(false);
  });

  it('una recarga conserva los hilos y las preferencias ligeras; los proyectos antiguos se ignoran', () => {
    const state = restoreWith({
      projects: [{ id: 'p1', name: 'Tienda' }],
      threads: [{ id: 't1', title: 'Hilo', projectId: 'p1', messages: [{ role: 'user', text: 'hola' }] }, { id: 'bad' }],
      activeProjectId: 'p1',
      chatPanelWidth: 900,
    });
    expect(state.threads).toHaveLength(1); // el hilo mal formado se descarta
    expect(state.threads[0]).toEqual({ id: 't1', title: 'Hilo', service: null, view: 'default', messages: [{ role: 'user', text: 'hola' }] });
    expect(state).not.toHaveProperty('projects');
    expect(state.chatPanelWidth).toBe(640);
  });

  it('una primera visita empieza en el lienzo limpio y sin hilos', () => {
    const state = restoreWith(null);
    expect(state.activeThreadId).toBeNull();
    expect(state.threads).toEqual([]);
  });

  it('recargar dentro de un servicio vuelve al lienzo; ?service= abre ese servicio', () => {
    expect(entryRedirect('/espacio', '')).toBeNull();
    expect(entryRedirect('/espacio/erp', '')).toBe('/espacio');
    expect(entryRedirect('/espacio/producto/UON-KIT-01/gpsr', '')).toBe('/espacio');
    expect(entryRedirect('/espacio', '?service=producto')).toBe('/espacio/producto');
    expect(entryRedirect('/espacio/erp', '?service=nexus')).toBe('/espacio/nexus');
    expect(entryRedirect('/espacio', '?service=otro')).toBe('/espacio');
  });

  it('las páginas del espacio (Configuración, facturación) sobreviven a la recarga', () => {
    expect(entryRedirect('/espacio/configuracion/uso', '')).toBeNull();
    expect(entryRedirect('/espacio/configuracion/plan', '?pago=ok')).toBeNull();
    expect(entryRedirect('/espacio/facturacion/recargas', '')).toBeNull();
    expect(workspacePageOf('/espacio/configuracion/cuenta')).toEqual({ id: 'configuracion', name: 'Configuración' });
    expect(workspacePageOf('/espacio/configuracion')).toEqual({ id: 'configuracion', name: 'Configuración' });
    expect(workspacePageOf('/espacio/erp')).toBeNull();
    expect(workspacePageOf('/configuracion')).toBeNull();
  });
});

function restoreWith(saved: unknown) {
  return restoreWorkspace(saved === null ? null : JSON.parse(JSON.stringify(saved)));
}

describe('enrutado de peticiones (workspace-routing)', () => {
  it('una petición sin servicio se queda en la conversación, sin abrir Producto', () => {
    expect(routePrompt('oikl', null).service).toBeNull();
    expect(routePrompt('oikl', null).response).toMatch(/Amazon/);
    expect(routePrompt('hola, ¿qué puedes hacer?', null).service).toBeNull();
  });

  it('las intenciones reconocidas abren su servicio y un servicio abierto se conserva', () => {
    expect(routePrompt('quiero subir un producto a Amazon', null).service).toBe('producto');
    expect(routePrompt('quiero subir un producto a Amazon', null).catalog).toBe(true);
    expect(routePrompt('quiero conectar mi cuenta de Amazon', null).service).toBe('nexus');
    expect(routePrompt('gracias', 'erp')).toEqual({ service: 'erp', response: 'Sigo contigo en ERP. ¿Qué quieres hacer ahora?' });
  });

  it('la respuesta respeta dónde está la persona al llegar', () => {
    const route = routePrompt('Quiero subir un producto', 'producto');
    const moved = resolveReply({ route, origin: { service: null, view: 'default' }, current: { service: 'erp', view: 'default' }, sameThread: true, hasSheet: false, sheetTitle: null });
    expect(moved).toMatchObject({ stayed: false, navigate: false });
    const back = resolveReply({ route, origin: { service: 'producto', view: 'default' }, current: { service: 'producto', view: 'default' }, sameThread: true, hasSheet: true, sheetTitle: 'Lámpara' });
    expect(back).toMatchObject({ stayed: true, toCatalog: true, navigate: true });
    expect(back.reply).toMatch(/Aquí tienes tu catálogo/);
    const sheet = resolveReply({ route: routePrompt('Mejora la descripción', 'producto'), origin: { service: 'producto', view: 'new-product' }, current: { service: 'producto', view: 'new-product' }, sameThread: true, hasSheet: true, sheetTitle: null });
    expect(sheet).toMatchObject({ stayed: true, toCatalog: false, navigate: false, view: 'new-product' });
    expect(sheet.reply).toBe('Sigo contigo en la ficha de «tu nuevo producto». ¿Qué quieres cambiar?');
  });
});

describe('rutas del espacio', () => {
  it('servicio y vista se leen de la URL', () => {
    expect(parseWorkspacePath('/espacio')).toMatchObject({ service: null, view: 'default', hasSheet: false });
    expect(parseWorkspacePath('/espacio/nexus/amazon')).toMatchObject({ service: 'nexus', view: 'amazon' });
    expect(parseWorkspacePath('/espacio/producto/nuevo')).toMatchObject({ service: 'producto', view: 'new-product', hasSheet: true });
    expect(parseWorkspacePath('/espacio/producto/A1/gpsr')).toMatchObject({ service: 'producto', view: 'default', hasSheet: true });
    expect(servicePath('producto', 'new-product')).toBe('/espacio/producto/nuevo');
    expect(servicePath('nexus', 'shopify')).toBe('/espacio/nexus/shopify');
    expect(servicePath(null)).toBe('/espacio');
    expect(screenKey({ service: 'nexus', view: 'amazon' }, null)).toBe('nexus:amazon');
    expect(screenKey({ service: 'producto', view: 'new-product' }, null)).toBe('producto');
    expect(screenKey({ service: null, view: 'default' }, 't1')).toBe('chat:t1');
  });

  it('el título de un hilo nuevo se corta a 36 caracteres', () => {
    expect(threadTitle('Hola')).toBe('Hola');
    expect(threadTitle('Quiero subir todos mis productos de la tienda a Amazon')).toBe('Quiero subir todos mis productos de…');
  });
});

describe('conversación centrada o a la derecha (chat-panel-layout)', () => {
  const visible = (input: Partial<Parameters<typeof chatPanelVisible>[0]>) =>
    chatPanelVisible({ service: null, centred: false, narrow: false, sheetOpen: false, collapsed: false, ...input });

  it('centrada sin servicio; panel (u hoja) con uno', () => {
    expect(visible({})).toBe(true);
    expect(visible({ narrow: true })).toBe(true);
    expect(visible({ service: 'nexus' })).toBe(true);
    expect(visible({ service: 'nexus', collapsed: true })).toBe(false);
    expect(visible({ service: 'nexus', narrow: true })).toBe(false); // en móvil se ve primero el servicio
    expect(visible({ service: 'nexus', narrow: true, sheetOpen: true })).toBe(true);
    expect(visible({ service: 'producto', centred: true, collapsed: true })).toBe(true); // Producto sin ficha
  });

  it('las clases de la columna y los controles siguen a la disposición', () => {
    const side = chatLayout({ service: 'erp', centred: false, narrow: false, sheetOpen: false, collapsed: true });
    expect(side.columnClasses).toEqual({ 'is-module': true, 'is-product-chat': false, 'is-chat-hidden': true, 'is-chat-sheet': false });
    expect(side.toggleLabel).toBe('Mostrar conversación');
    const sheet = chatLayout({ service: 'erp', centred: false, narrow: true, sheetOpen: true, collapsed: false });
    expect(sheet).toMatchObject({ scrimHidden: false, fabHidden: true, backgroundInert: true, toggleLabel: 'Ocultar conversación' });
    const centred = chatLayout({ service: 'producto', centred: true, narrow: false, sheetOpen: false, collapsed: false });
    expect(centred).toMatchObject({ toggleHidden: true, sidePanel: false });
  });

  it('el borde redimensiona entre 360 y 640 px, con las flechas y Inicio/Fin', () => {
    expect(chatWidthLimits(1600)).toEqual({ min: 360, max: 640 });
    expect(chatWidthLimits(900)).toEqual({ min: 360, max: 420 });
    expect(sashKeyWidth('ArrowLeft', 400, 1600)).toBe(424);
    expect(sashKeyWidth('ArrowRight', 400, 1600)).toBe(376);
    expect(sashKeyWidth('Home', 400, 1600)).toBe(640);
    expect(sashKeyWidth('End', 400, 1600)).toBe(360);
    expect(sashKeyWidth('a', 400, 1600)).toBeUndefined();
  });
});

describe('hilos (composer-threads-grouping)', () => {
  const thread = (id: string): Thread => ({ id, title: id.toUpperCase(), service: null, view: 'default', messages: [] });
  const base = { threads: [thread('t1'), thread('t2'), thread('t3')] };

  it('Recientes lista todos los hilos, del más reciente al más antiguo', () => {
    expect(recentThreads(base).map(item => item.id)).toEqual(['t3', 't2', 't1']);
  });
});
