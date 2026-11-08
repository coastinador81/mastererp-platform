import { useEffect, useState } from 'react';
import { useUiStore } from '../hooks/uiStore';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore, visibleComposerStatus } from '../hooks/composerStore';
import { liveProgressLabel, useLiveWorkProgress } from '../hooks/liveWorkProgress';
import { activeConversationStatusOf } from '../hooks/activeConversationStatus';
import { useWrittenFollowups } from '../hooks/writtenFollowup';
import { isLiveVoiceBackdrop } from '../hooks/liveVoiceStatus';
import { slowThinkingFor, useSlowThinking } from '../hooks/slowThinking';

// En voz, los estados de un mismo encargo llegan por separado y con huecos de milisegundos
// («entendiendo» → «revisando tu Drive» → «preparando su respuesta»). Mantener el último un
// instante evita que el aviso desaparezca y vuelva, y que la conversación suba y baje con él.
// Un aviso nuevo en la línea de estado (un error, «no he podido…») lo retira en el acto; el
// paso entre escuchar y hablar es solo fondo y no lo corta.
const VOICE_HOLD_MS = 300;
type Held = { threadId: string | null; label: string; status: string };

/** Un único estado visible junto al compositor; nunca crea un mensaje del hilo. */
export function ConversationActiveIndicator() {
  const thread = useWorkspaceStore(activeThreadOf);
  const pending = useUiStore(state => state.pendingReply);
  const status = useComposerStore(state => visibleComposerStatus(state, thread?.id ?? null));
  const voice = useComposerStore(state => state.listening === 'talk');
  const account = useWorkspaceStore(state => state.historyAccount);
  const epoch = useWorkspaceStore(state => state.historyEpoch);
  const liveLabel = useLiveWorkProgress(state => thread && account ? liveProgressLabel(state, { account, epoch, threadId: thread.id }) : null);
  const followup = useWrittenFollowups(state => state.pending.some(item => item.account === account
    && item.epoch === epoch && item.threadId === thread?.id));
  const active = activeConversationStatusOf(thread, pending, status) ?? (liveLabel ? { label: liveLabel }
    : followup ? { label: 'Consultando tu solicitud…' } : null);
  const threadId = thread?.id ?? null;
  // Lote 9: a los 20 s sin texto, el aviso pasa al sitio de la respuesta y aquí no se repite.
  const slowHere = useSlowThinking(slowThinkingFor(threadId));
  const label = active?.label ?? null;
  const [held, setHeld] = useState<Held | null>(null);
  if (label && (held?.label !== label || held?.threadId !== threadId || held?.status !== status))
    setHeld({ threadId, label, status });
  useEffect(() => {
    if (label || !held) return;
    const timer = window.setTimeout(() => setHeld(null), VOICE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [label, held]);
  const shown = label ?? (voice && held?.threadId === threadId
    && (held.status === status || isLiveVoiceBackdrop(status)) ? held.label : null);
  if (!shown || slowHere) return null;
  return <div className="conversation-active-indicator" role="status" aria-live="polite" aria-busy="true">
    <span className="conversation-active-dot" aria-hidden="true" />
    <span>{shown}</span>
  </div>;
}
