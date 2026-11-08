import { liveWorkLabel, observeLiveProgressWork, updateLiveWork } from './liveWorkProgress';
import type { LiveTransportEvent } from '../api/liveTransport';
import { useComposerStore } from './composerStore';
import { durableIdentity, showDurablePending, showDurableProgress } from './durableDelivery';
import { durableReadStatus, isDurableReadStatus, watchDurableRequest } from './durableRequestWatcher';
import { setUi, useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';
import { observeSemanticRecovery } from './semanticRecovery';

type Handoff = Extract<LiveTransportEvent, { type: 'handoff' }>;
const observed = new Set<string>();

function driveAccessTurn(event: Handoff): boolean {
  const message = useWorkspaceStore.getState().threads.find(thread => thread.id === event.threadId)
    ?.messages.find(item => item.role === 'user' && item.turnId === event.turnId);
  const text = message?.text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  // La etiqueta específica exige una consulta exclusiva; una orden compuesta mantiene el estado genérico.
  return /^(?:una pregunta )?(?:(?:tienes|teneis) acceso a (?:mi |google )?drive|(?:puedes|podeis) acceder a (?:mi |google )?drive|(?:comprueba|verifica)(?: si tienes)? (?:el )?acceso a (?:mi |google )?drive|esta conectado (?:mi |google )?drive)$/.test(text);
}

/** El puente de voz solo avisa de un trabajo persistido; el resultado se lee del servidor. */
export function observeLiveHandoff(event: Handoff, account: string, epoch: number): void {
  if (!durableIdentity(account, epoch)) return;
  const scope = { account, epoch, threadId: event.threadId };
  observeLiveProgressWork(scope, event);
  const key = `${account}:${epoch}:${event.requestId}`;
  const terminal = !['queued', 'running'].includes(event.status);
  const refresh = () => useWorkspaceStore.getState().retryHistory?.();
  // La finalización llega por la misma sesión autenticada: el trabajo ya no
  // está pendiente aunque la siguiente lectura del historial tarde en llegar.
  if (terminal && useUiStore.getState().pendingReply?.requestId === event.requestId
    && useUiStore.getState().pendingReply?.threadId === event.threadId) setUi({ pendingReply: null });
  refresh();
  observeSemanticRecovery(account, epoch, event);
  const current = useUiStore.getState().pendingReply;
  if (!terminal && event.intent && current?.requestId === event.requestId && current.threadId === event.threadId)
    setUi({ pendingReply: { ...current, purpose: event.intent, label: liveWorkLabel(event.intent, undefined, event.status) } });
  if (observed.has(key)) return;
  observed.add(key);
  if (!terminal) {
    const driveAccess = event.intent === 'drive_access' || (!event.intent && driveAccessTurn(event));
    showDurablePending(account, epoch, event.requestId, event.threadId,
      event.intent ? liveWorkLabel(event.intent, undefined, event.status)
        : driveAccess ? 'Uony está revisando tu Drive…' : 'Uony está trabajando en tu petición…',
      event.intent ?? (driveAccess ? 'drive_access' : undefined));
  }
  watchDurableRequest({ account, epoch, requestId: event.requestId, threadId: event.threadId,
    valid: () => durableIdentity(account, epoch),
    settled: result => {
      if (!durableIdentity(account, epoch)) return;
      updateLiveWork(scope, event.requestId, result.status);
      if (useUiStore.getState().pendingReply?.requestId === event.requestId) setUi({ pendingReply: null });
      if (result.status !== 'success') useComposerStore.getState().setThreadStatus(event.threadId,
        result.error?.message || 'No hemos podido completar esta petición. Revisa su estado en la conversación.');
      refresh();
      observeSemanticRecovery(account, epoch, result);
    },
    progressed: result => {
      updateLiveWork(scope, event.requestId, result.status, result.progress?.stage);
      showDurableProgress(account, epoch, result);
    },
    readError: error => {
      if (durableIdentity(account, epoch)) useComposerStore.getState().setThreadStatus(event.threadId,
        durableReadStatus(error));
    },
    readRecovered: () => {
      const composer = useComposerStore.getState();
      if (isDurableReadStatus(composer.threadStatuses[event.threadId] ?? '')) composer.clearThreadStatus(event.threadId);
    },
    missing: () => {
      if (!durableIdentity(account, epoch)) return;
      updateLiveWork(scope, event.requestId, 'unknown');
      observed.delete(key);
      if (useUiStore.getState().pendingReply?.requestId === event.requestId) setUi({ pendingReply: null });
      useComposerStore.getState().setThreadStatus(event.threadId,
        'No podemos consultar este encargo. No se iniciará otra ejecución automáticamente.');
      refresh();
    },
  });
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => observed.clear());
