import { useConversationRecovery } from '../hooks/liveConversation';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useSession } from './authBridge';
import { ConversationConnection } from './ConversationConnection';
import '../styles/conversation-form.css';

/** Un fallo de conexión también necesita controles cuando todavía no existe un hilo. */
export function ConversationRecovery() {
  const account = useSession().user?.email;
  const threadId = useWorkspaceStore(state => state.activeThreadId);
  const recovery = useConversationRecovery(state => state.recovery);
  if (!account || !recovery || recovery.account !== account || recovery.threadId !== threadId) return null;
  return <section className="conversation-recovery" aria-label="Conexión necesaria">
    <p role="alert">{recovery.message}</p>
    <p>Gestiona la conexión aquí y vuelve a enviar tu mensaje cuando esté lista.</p>
    {recovery.actions.map(action => <ConversationConnection key={`${account}:${threadId}:${action.provider}`} account={account} provider={action.provider} />)}
  </section>;
}
