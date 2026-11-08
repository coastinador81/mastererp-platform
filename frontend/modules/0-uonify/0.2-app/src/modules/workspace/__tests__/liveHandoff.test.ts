import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { currentAccountEmail } from '@/modules/auth';
import { durableIdentity } from '../hooks/durableDelivery';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { watchDurableRequest } from '../hooks/durableRequestWatcher';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi, useUiStore } from '../hooks/uiStore';

const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account.email }));
vi.mock('../hooks/durableRequestWatcher', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/durableRequestWatcher')>(),
  watchDurableRequest: vi.fn(),
}));

beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null }); vi.clearAllMocks();
  useWorkspaceStore.setState({ historyAccount: account.email,
    threads: [{ id: 'thread-one', title: 'Basic', service: null, view: 'default',
      messages: [{ role: 'user', text: 'Analiza mis documentos', turnId: 'voice-turn' }] }],
    activeThreadId: 'thread-one', retryHistory: vi.fn() });
});

it('observa el encargo persistido sin volver a enviar ni duplicar la frase de voz', () => {
  const post = vi.spyOn(api, 'post');
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'request-one', status: 'queued' as const };
  expect(currentAccountEmail()).toBe(account.email);
  expect(durableIdentity(account.email, useWorkspaceStore.getState().historyEpoch)).toBe(true);
  observeLiveHandoff(event, account.email, useWorkspaceStore.getState().historyEpoch);
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
  expect(useUiStore.getState().pendingReply?.requestId).toBe(event.requestId);

  const watch = vi.mocked(watchDurableRequest).mock.calls[0][0];
  watch.settled({ requestId: event.requestId, threadId: event.threadId, status: 'success',
    response: { reply: 'Te propongo revisar la carpeta.', model: 'gemini-3.5-flash', effort: 'medium' } });
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled();
});

it('muestra la comprobación de Drive solo tras un handoff real del turno exacto', () => {
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => ({ ...thread,
    messages: [{ role: 'user', text: 'Una pregunta, ¿tienes acceso a mi Drive?', turnId: 'voice-turn' }],
  })) }));
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'drive-access-request', status: 'queued' as const };
  observeLiveHandoff(event, account.email, useWorkspaceStore.getState().historyEpoch);
  expect(useUiStore.getState().pendingReply?.label).toBe('Uony está revisando tu Drive…');
  vi.mocked(watchDurableRequest).mock.calls[0][0].progressed?.({ requestId: event.requestId,
    threadId: event.threadId, status: 'running', progress: { stage: 'consulting_google', seq: 2 } });
  expect(useUiStore.getState().pendingReply?.label).toBe('Uony está revisando tu Drive…');
  vi.mocked(watchDurableRequest).mock.calls[0][0].settled({ requestId: event.requestId,
    threadId: event.threadId, status: 'success', sourceLiveTurnId: event.turnId,
    response: { reply: 'El acceso está disponible.', model: 'gemini-3.5-flash', effort: 'medium' } });
  expect(useUiStore.getState().pendingReply).toBeNull();
});

it.each([
  '¿Tienes acceso a mi Drive y crea un producto?',
  'Comprueba el acceso a mi Drive y analiza la carpeta',
  'Quiero crear un producto, ¿tienes acceso a mi Drive?',
])('mantiene el estado genérico para la petición compuesta «%s»', (turn, index) => {
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => ({ ...thread,
    messages: [{ role: 'user', text: turn, turnId: 'voice-turn' }],
  })) }));
  observeLiveHandoff({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
    requestId: `compound-drive-${index}`, status: 'queued' }, account.email,
  useWorkspaceStore.getState().historyEpoch);
  expect(useUiStore.getState().pendingReply?.label).toBe('Uony está trabajando en tu petición…');
  expect(useUiStore.getState().pendingReply?.purpose).toBeUndefined();
});

it('etiqueta una orden exclusiva de comprobar acceso a Drive tras el handoff', () => {
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => ({ ...thread,
    messages: [{ role: 'user', text: 'Comprueba el acceso a mi Drive', turnId: 'voice-turn' }],
  })) }));
  observeLiveHandoff({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'exclusive-drive-access', status: 'queued' }, account.email,
  useWorkspaceStore.getState().historyEpoch);
  expect(useUiStore.getState().pendingReply?.label).toBe('Uony está revisando tu Drive…');
  expect(useUiStore.getState().pendingReply?.purpose).toBe('drive_access');
});

it('tras dos lecturas 404 permite reobservar el mismo trabajo sin crear otro', () => {
  const post = vi.spyOn(api, 'post');
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'request-retry', status: 'queued' as const };
  const epoch = useWorkspaceStore.getState().historyEpoch;
  observeLiveHandoff(event, account.email, epoch);
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  vi.mocked(watchDurableRequest).mock.calls[0][0].missing?.();
  expect(useUiStore.getState().pendingReply).toBeNull();

  observeLiveHandoff(event, account.email, epoch);
  expect(watchDurableRequest).toHaveBeenCalledTimes(2);
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});

it('un aviso terminal limpia el progreso al llegar, sin esperar al siguiente sondeo ni duplicar trabajo', () => {
  const post = vi.spyOn(api, 'post');
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'request-terminal', status: 'queued' as const };
  const epoch = useWorkspaceStore.getState().historyEpoch;
  observeLiveHandoff(event, account.email, epoch);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(event.requestId);

  observeLiveHandoff({ ...event, status: 'success' }, account.email, epoch);
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  vi.mocked(watchDurableRequest).mock.calls[0][0].settled({ requestId: event.requestId,
    threadId: event.threadId, status: 'success', sourceLiveTurnId: event.turnId,
    response: { reply: 'Encontré el resultado.', model: 'gemini-3.5-flash', effort: 'medium' } });
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalledTimes(3);
  expect(post).not.toHaveBeenCalled();
});

it('el primer aviso terminal también inicia la lectura verificable sin crear una burbuja local', () => {
  const post = vi.spyOn(api, 'post');
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'request-terminal-first', status: 'success' as const };
  observeLiveHandoff(event, account.email, useWorkspaceStore.getState().historyEpoch);
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalledOnce();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});

it('observa una sola vez el resultado durable sin abrir otra vía de audio', () => {
  const event = { type: 'handoff' as const, threadId: 'thread-one', turnId: 'voice-turn',
    requestId: 'request-spoken', status: 'queued' as const };
  const epoch = useWorkspaceStore.getState().historyEpoch;
  observeLiveHandoff(event, account.email, epoch);
  observeLiveHandoff({ ...event, status: 'success' }, account.email, epoch);
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  const settled = vi.mocked(watchDurableRequest).mock.calls[0][0].settled;
  settled({ requestId: event.requestId, threadId: event.threadId, status: 'success',
    sourceLiveTurnId: 'different-turn',
    response: { reply: 'No corresponde a este turno.', model: 'gemini', effort: 'medium' } });
  settled({ requestId: event.requestId, threadId: event.threadId, status: 'success',
    sourceLiveTurnId: event.turnId,
    response: { reply: 'Esta es la respuesta guardada.', model: 'gemini', effort: 'medium' } });
  expect(watchDurableRequest).toHaveBeenCalledOnce();
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalled();
});
