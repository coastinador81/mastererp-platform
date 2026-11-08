import { useComposerStore } from '../hooks/composerStore';
import { wantsChatOnly } from '../model/routePrompt';
import { selectService, startNewThread, returnToChat } from '../hooks/actions';
import { sendPrompt } from '../hooks/conversation';
import { useUiStore, workspaceRefs } from '../hooks/uiStore';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { onAssistantReply } from '../model/events';
import { fakeNavigate, resetStores } from './harness';

// El motor no pinta nada: auth y los módulos de la cabecera no hacen falta.
vi.mock('../components/authBridge', () => ({ AuthDialogs: () => null, takePendingPrompt: () => '', useSession: () => ({ status: 'ready' }) }));
vi.mock('../components/moduleBridge', () => ({ HelpButton: () => null, NotificationsBell: () => null, settingsPath: () => '/espacio/configuracion/cuenta' }));

vi.mock('../api/assistant', () => ({
  ASSISTANT_ENDPOINTS: { USAGE: '/ai/usage', MESSAGES: '/assistant/messages' },
  getUsage: vi.fn(() => Promise.resolve(null)),
  postAssistantMessage: vi.fn(() => Promise.resolve({ id: 'm1', threadId: 't', receivedAt: '', usage: { limits: [] } })),
}));

// Puerto de tests/motion-and-rail y composer-threads-grouping del prototipo: la
// antesala de cada respuesta y «Nuevo hilo».

const thread = () => activeThreadOf(useWorkspaceStore.getState());
const roles = () => thread()?.messages.map(message => message.role).join();

beforeEach(() => {
  vi.useFakeTimers();
  resetStores('/espacio');
  workspaceRefs.navigate = vi.fn(fakeNavigate());
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('la antesala de la respuesta', () => {
  it('«Revisando tu petición…», después «Abriendo X…», y solo entonces la respuesta y la pantalla', () => {
    const replies: string[] = [];
    const stop = onAssistantReply(text => replies.push(text));
    expect(sendPrompt('Quiero crear una ficha de producto')).toBe(true);
    expect(roles()).toBe('user'); // aún sin respuesta
    expect(useUiStore.getState().route.service).toBeNull(); // aún sin saltar
    expect(useUiStore.getState().pendingReply?.label).toBe('Revisando tu petición…');
    expect(thread()?.messages[0]).toMatchObject({ model: 'auto', effort: 'medium', speed: 'standard' });
    expect(sendPrompt('otra cosa')).toBe(false); // una respuesta cada vez

    vi.advanceTimersByTime(500);
    expect(useUiStore.getState().pendingReply?.label).toBe('Abriendo Producto…');
    expect(roles()).toBe('user');

    vi.advanceTimersByTime(450);
    expect(roles()).toBe('user,assistant');
    expect(useUiStore.getState().route.service).toBe('producto');
    expect(workspaceRefs.navigate).toHaveBeenCalledWith('/espacio/producto', undefined);
    expect(useUiStore.getState().pendingReply).toBeNull();
    expect(replies).toHaveLength(1);
    vi.advanceTimersByTime(50);
    // Se anuncia una vez, fuera de la burbuja.
    expect(useUiStore.getState().liveText).toBe('Uony: Aquí tienes tu catálogo. Puedes importar tus productos o crear uno nuevo, o contarme qué quieres subir y lo preparo contigo.');
    stop();
  });

  it('sin pantalla nueva, la respuesta llega tras un «Revisando tu petición…» breve', () => {
    sendPrompt('hola');
    vi.advanceTimersByTime(650);
    expect(roles()).toBe('user');
    vi.advanceTimersByTime(60);
    expect(roles()).toBe('user,assistant');
    expect(useUiStore.getState().route.service).toBeNull(); // se queda en la conversación
  });

  it('si la persona se va a otro sitio mientras Uony piensa, la respuesta no la trae de vuelta', () => {
    sendPrompt('Quiero crear otra ficha');
    useUiStore.setState({ route: { ...useUiStore.getState().route, service: 'erp', pathname: '/espacio/erp' } });
    vi.advanceTimersByTime(1000);
    expect(useUiStore.getState().route.service).toBe('erp');
    expect(thread()?.messages.at(-1)?.role).toBe('assistant');
  });

  it('una petición escrita antes de entrar llega enseguida (la bienvenida fue su antesala)', () => {
    sendPrompt('Quiero crear una ficha de producto', { immediate: true });
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // solo el anuncio de la región viva
    expect(roles()).toBe('user,assistant');
    expect(useUiStore.getState().route.service).toBe('producto');
  });
});

describe('Producto y la ficha abierta', () => {
  it('una respuesta conserva la ficha nueva abierta', () => {
    resetStores('/espacio/producto/nuevo');
    sendPrompt('Genera una descripción para este producto');
    vi.advanceTimersByTime(1000);
    expect(useUiStore.getState().route.view).toBe('new-product');
    expect(workspaceRefs.navigate).not.toHaveBeenCalled();
    expect(thread()?.messages.at(-1)?.text).toBe('Sigo contigo en la ficha de «tu nuevo producto». ¿Qué quieres cambiar?');
  });

  it('en la ficha de un producto guardado, Uony lo nombra', () => {
    resetStores('/espacio/producto/A1');
    useUiStore.setState({ sheetTitle: 'Lámpara' });
    sendPrompt('Mejora la descripción');
    vi.advanceTimersByTime(1000);
    expect(thread()?.messages.at(-1)?.text).toBe('Sigo contigo en la ficha de «Lámpara». ¿Qué quieres cambiar?');
  });

  it('pedir subir un producto vuelve al catálogo con la conversación centrada', () => {
    resetStores('/espacio/producto/A1');
    sendPrompt('Quiero subir un producto');
    vi.advanceTimersByTime(1000);
    expect(workspaceRefs.navigate).toHaveBeenCalledWith('/espacio/producto', undefined);
    expect(useUiStore.getState().route.hasSheet).toBe(false);
    expect(thread()?.messages.at(-1)?.text).toMatch(/Aquí tienes tu catálogo/);
  });
});

describe('hilos y servicios', () => {
  it('«Nuevo hilo» vuelve al lienzo en blanco y cierra los paneles', () => {
    resetStores('/espacio/producto/nuevo');
    const store = useWorkspaceStore.getState();
    store.createThread({ title: 'Hola', service: 'producto', view: 'new-product' });
    store.setConversationExpanded(true);
    useUiStore.setState({ navOpen: true, servicesOpen: true });
    startNewThread();
    const state = useWorkspaceStore.getState();
    expect(state.activeThreadId).toBeNull();
    expect(state.conversationExpanded).toBe(false);
    expect(state.threads).toHaveLength(1); // el hilo sigue en «Recientes»
    expect(useUiStore.getState()).toMatchObject({ navOpen: false, servicesOpen: false });
    expect(useUiStore.getState().route.service).toBeNull();
  });

  it('elegir un servicio lo recuerda en el hilo abierto; volver a Producto conserva la ficha', () => {
    useWorkspaceStore.getState().createThread({ title: 'Hola', service: null, view: 'default' });
    selectService('nexus', 'amazon');
    expect(useUiStore.getState().route.pathname).toBe('/espacio/nexus/amazon');
    expect(thread()).toMatchObject({ service: 'nexus', view: 'amazon' });
    resetStores('/espacio/producto/A1');
    workspaceRefs.navigate = vi.fn(fakeNavigate());
    selectService('producto');
    expect(workspaceRefs.navigate).not.toHaveBeenCalled();
  });
});


describe('Regresar al chat conservando la conversación', () => {
  it('vuelve al inicio con el mismo hilo, mensajes y texto pendiente', () => {
    resetStores('/espacio/producto/A1');
    const store = useWorkspaceStore.getState();
    const original = store.createThread({ title: 'Mi producto', service: 'producto', view: 'sku:A1' });
    store.pushMessage(original.id, { role: 'user', text: 'Prepara el producto' });
    useComposerStore.getState().setDraft('Cambia el título');
    useUiStore.setState({ servicesOpen: true, navOpen: true, chatSheetOpen: true });
    returnToChat();
    expect(thread()?.id).toBe(original.id);
    expect(thread()?.messages.at(-1)?.text).toBe('Prepara el producto');
    expect(thread()?.service).toBeNull();
    expect(useComposerStore.getState().draft).toBe('Cambia el título');
    expect(useUiStore.getState().route.pathname).toBe('/espacio');
    expect(useUiStore.getState()).toMatchObject({ servicesOpen: false, navOpen: false, chatSheetOpen: false });
  });
  it('entiende las órdenes de voz y texto sin borrar el hilo ni cancelar trabajo pendiente', () => {
    resetStores('/espacio/producto/A1');
    const original = useWorkspaceStore.getState().createThread({ title: 'Mi producto', service: 'producto', view: 'sku:A1' });
    useUiStore.setState({ pendingReply: { threadId: original.id, label: 'Preparando…' } });
    expect(sendPrompt('Uony, límpiame la interfaz')).toBe(true);
    expect(thread()?.id).toBe(original.id);
    expect(thread()?.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(useUiStore.getState().route.pathname).toBe('/espacio');
    expect(useUiStore.getState().pendingReply?.threadId).toBe(original.id);
    for (const text of ['llévame a la pantalla principal', 'volver al chat', 'muéstrame solo el chat', 'quita las barras laterales']) expect(wantsChatOnly(text)).toBe(true);
    for (const text of ['no limpies la interfaz', 'cambia el título a pantalla principal', 'quiero subir un producto']) expect(wantsChatOnly(text)).toBe(false);
  });
});
