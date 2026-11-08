import { waitFor } from '@testing-library/react';
import { api, ApiError } from '@/shared/api/client';
import { expectedAssignmentFocus, rememberExpectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { sendLivePrompt } from '../hooks/liveConversation';
import { setUi, useUiStore } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
const goal = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  identity.account = 'sellerify@example.test';
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: '', status: '' });
  useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'thread-a',
    threads: [
      { id: 'thread-a', title: 'Basic', service: null, view: 'default', messages: [
        { role: 'assistant', text: 'Podemos continuar con Basic.' }] },
      { id: 'thread-b', title: 'Otro', service: null, view: 'default', messages: [] },
    ] });
  useGooglePreferences.setState({ account: identity.account, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
// Lote 6: Uony explica el rechazo en la conversación; el compositor no muestra errores.
const RECHECK = { role: 'assistant', model: 'uonify-guide', requestStatus: 'error',
  text: 'No hemos podido confirmar el encargo de esta conversación. Conservamos tu texto; revisa el encargo antes de enviarlo otra vez.' };
const threadA = () => useWorkspaceStore.getState().threads[0].messages;

it('vincula a A dos mensajes del mismo hilo, sin llevar el foco al otro hilo', async () => {
  expect(rememberExpectedAssignmentFocus(identity.account, 'thread-a', goal, 3)).toBe(true);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Listo.' });
  expect(sendLivePrompt('Primera pregunta')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(sendLivePrompt('Seguimos con el producto')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 'thread-a',
    expectedAssignmentFocus: { assignmentId: goal, version: 3 } });
  expect(post.mock.calls[1][1]).toMatchObject({ threadId: 'thread-a',
    expectedAssignmentFocus: { assignmentId: goal, version: 3 } });
  expect(expectedAssignmentFocus(identity.account, 'thread-a')).toMatchObject({ kind: 'ready' });
  useWorkspaceStore.getState().setActiveThread('thread-b');
  expect(sendLivePrompt('Nuevo tema')).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  expect(post.mock.calls[2][1]).not.toHaveProperty('expectedAssignmentFocus');
});

it('el 409 de otra pestaña conserva el texto y la intención A y pide releer el encargo', async () => {
  expect(rememberExpectedAssignmentFocus(identity.account, 'thread-a', goal, 3)).toBe(true);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409,
    { error: 'assignment_focus_conflict', message: 'El foco cambió.' }));
  const conflict = vi.fn(); window.addEventListener('uonify:assignment-focus-conflict', conflict);
  expect(sendLivePrompt('Sigue con Basic')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().draft).toBe('Sigue con Basic');
  expect(useComposerStore.getState().status).toBe('');
  expect(threadA()).toEqual([{ role: 'assistant', text: 'Podemos continuar con Basic.' }, RECHECK]);
  expect(conflict).toHaveBeenCalledOnce();
  expect((conflict.mock.calls[0][0] as CustomEvent).detail).toEqual({ account: identity.account, threadId: 'thread-a' });
  expect(expectedAssignmentFocus(identity.account, 'thread-a')).toMatchObject({ kind: 'ready', value: {
    assignmentId: goal, version: 3 } });
  window.removeEventListener('uonify:assignment-focus-conflict', conflict);
});

it('una pestaña nueva sin expectativa no adopta B al recibir 409 y conserva el mensaje', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409,
    { error: 'assignment_focus_required', message: 'Hay un encargo en foco.' }));
  const conflict = vi.fn(); window.addEventListener('uonify:assignment-focus-conflict', conflict);
  expect(expectedAssignmentFocus(identity.account, 'thread-a')).toEqual({ kind: 'none' });
  expect(sendLivePrompt('Sigue con Basic')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post.mock.calls[0][1]).not.toHaveProperty('expectedAssignmentFocus');
  expect(useComposerStore.getState().draft).toBe('Sigue con Basic');
  expect(threadA()).toEqual([{ role: 'assistant', text: 'Podemos continuar con Basic.' }, RECHECK]);
  expect(useComposerStore.getState().status).toBe('');
  expect(conflict).toHaveBeenCalledOnce();
  window.removeEventListener('uonify:assignment-focus-conflict', conflict);
});

it('una expectativa local dañada bloquea el envío antes de quitar el borrador', () => {
  sessionStorage.setItem('uonify:expected-assignment-focus:' + JSON.stringify([identity.account, 'thread-a']), '{dañado');
  const post = vi.spyOn(api, 'post');
  useComposerStore.getState().setDraft('Texto aún sin enviar');
  expect(sendLivePrompt('Texto aún sin enviar')).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe('Texto aún sin enviar');
  expect(useComposerStore.getState().status).toBe('');
  expect(threadA()).toEqual([{ role: 'assistant', text: 'Podemos continuar con Basic.' }, { role: 'assistant',
    model: 'uonify-guide', requestStatus: 'error',
    text: 'No podemos comprobar el encargo seleccionado. Tu texto se conserva; vuelve a cargar la conversación.' }]);
});

it('un cambio de identidad retira la expectativa de la pestaña', () => {
  expect(rememberExpectedAssignmentFocus(identity.account, 'thread-a', goal, 3)).toBe(true);
  window.dispatchEvent(new Event('uonify:identity-changed'));
  expect(expectedAssignmentFocus(identity.account, 'thread-a')).toEqual({ kind: 'none' });
});

it('almacenamiento inaccesible falla cerrado y conserva el texto', () => {
  const post = vi.spyOn(api, 'post');
  useComposerStore.getState().setDraft('Seguimos con Basic');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  expect(sendLivePrompt('Seguimos con Basic')).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe('Seguimos con Basic');
});
