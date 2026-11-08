import { sendGuidedMessage } from '../hooks/guidedConversation';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useUiStore } from '../hooks/uiStore';
import { resetStores } from './harness';
const fakes = vi.hoisted(() => ({ post: vi.fn(), handle: vi.fn() }));
vi.mock('../api/assistant', () => ({ postAssistantMessage: fakes.post }));
vi.mock('@/modules/catalog', () => ({ guideOf: () => ({ step: 'files' }), handleGuideText: fakes.handle, pauseGuide: vi.fn(), productPath: vi.fn(), startsGuide: vi.fn() }));
vi.mock('../components/authBridge', () => ({ AuthDialogs: () => null, takePendingPrompt: () => '', useSession: () => ({ status: 'ready' }) }));
vi.mock('../components/moduleBridge', () => ({ HelpButton: () => null, NotificationsBell: () => null, settingsPath: () => '/espacio/configuracion/cuenta' }));
beforeEach(() => {
  vi.useFakeTimers(); resetStores('/espacio'); fakes.post.mockReset(); fakes.handle.mockReset(); fakes.post.mockResolvedValue({});
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });
const create = () => useWorkspaceStore.getState().createThread({ title: 'Preparar ficha', service: null, view: '' });

test('la antesala contextual se ve antes de una respuesta rápida y desaparece al responder', async () => {
  const thread = create(); fakes.handle.mockResolvedValue({ text: 'Tu ficha está lista.' });
  const sent = sendGuidedMessage(thread, 'Prepara la ficha');
  expect(useUiStore.getState().pendingReply?.label).toBe('Preparando tu ficha…');
  await vi.advanceTimersByTimeAsync(650);
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(50); await sent;
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('Tu ficha está lista.');
});

test('la espera continúa hasta que termina el trabajo, sin sumar retraso después', async () => {
  let finish!: (value: { text: string }) => void;
  fakes.handle.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const sent = sendGuidedMessage(create(), 'Prepara la ficha');
  await vi.advanceTimersByTimeAsync(2000);
  expect(useUiStore.getState().pendingReply?.label).toBe('Preparando tu ficha…');
  finish({ text: 'Lista' }); await sent;
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('Lista');
});

test('un fallo retira el indicador y muestra una respuesta recuperable', async () => {
  fakes.post.mockRejectedValue(new Error('sin conexión'));
  const sent = sendGuidedMessage(create(), 'Prepara la ficha');
  await vi.advanceTimersByTimeAsync(700); await sent;
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toContain('vuelve a intentarlo');
});
