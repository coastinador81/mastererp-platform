import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AmazonReasoningStatus, amazonRequirementsKey, getAmazonRequirements, type AmazonReasoning } from '@/modules/catalog';
import { currentAccountEmail } from '@/modules/auth';
import { useOwnedRequest } from '@/shared/hooks';
import { errorMessage } from '@/shared/api/client';
import { Icon } from '@/shared/ui';
import { prepareProductRequirements } from '../hooks/liveConversation';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useUiStore } from '../hooks/uiStore';
import type { ConversationFormData } from '../model/conversationForm';

interface Props { form: ConversationFormData; account: string; threadId: string; active: boolean; questionTarget: HTMLElement | null }

export function ConversationRequirementsProgress(props: Props) {
  // Cada respuesta del servidor inicia su propia observación, aunque conserve producto y consulta.
  return <RequirementsProgress key={`${props.account}:${props.threadId}:${props.form.id}`} {...props} />;
}

function RequirementsProgress({ form, account, threadId, active, questionTarget }: Props) {
  const owned = useOwnedRequest(account, currentAccountEmail);
  const selectedThread = useWorkspaceStore(state => state.activeThreadId);
  const pending = useUiStore(state => Boolean(state.pendingReply));
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const attempted = useRef(false);
  const context = form.context;
  const sku = context?.kind === 'product_guide' ? context.sku : '';
  const enabled = active && !!questionTarget && selectedThread === threadId && account === currentAccountEmail();
  const query = useQuery({ queryKey: [...amazonRequirementsKey(account, sku), ''],
    queryFn: ({ signal }) => owned.read(next => getAmazonRequirements(sku, next), signal),
    enabled, retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false,
    refetchInterval: state => enabled && state.state.status !== 'error' && ['queued', 'running'].includes(state.state.data?.evaluation.reasoning?.status ?? '') ? 3000 : false,
  });
  // Un error o un resultado completo del intento anterior no describe el formulario recién recibido.
  const evaluation = query.isFetchedAfterMount ? query.data?.evaluation : undefined;
  const reasoning: AmazonReasoning = evaluation?.reasoning ?? form.reasoning ?? {
    id: form.id, status: 'queued', message: 'Estamos comprobando los datos disponibles para tu producto.',
  };
  const finished = !!evaluation && evaluation.state !== 'reasoning';
  const prepare = (retry = false, acknowledgeUnknown = false) => {
    if (!enabled || pending || sending || !owned.current()) return false;
    setError(''); setSending(true);
    const accepted = prepareProductRequirements(sku, { ...(retry ? { retry: true, acknowledgeUnknown } : {}), onSettled: (success, reason) => {
      if (!owned.current()) return;
      setSending(false);
      if (!success) setError(reason || 'No hemos podido actualizar las preguntas. Puedes volver a intentarlo.');
    } });
    if (!accepted) { setSending(false); setError('Espera a que termine la respuesta actual y pulsa Continuar con Uony.'); }
    return accepted;
  };
  useEffect(() => {
    if (!enabled || !finished || query.isFetching || query.isError || pending || sending || attempted.current) return;
    attempted.current = true;
    // El servidor reutiliza la revisión terminada; esta acción solo guarda las preguntas vigentes en el hilo.
    prepare();
  });
  if (!enabled || !questionTarget) return null;
  return createPortal(<section className="uony-reasoning-panel" aria-label="Revisión de Uony para Amazon">
    {query.isError ? <div className="amazon-reasoning" role="alert"><p>{errorMessage(query.error, 'No se ha podido consultar el estado de la revisión.')}</p>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Consultar estado de nuevo</button></div>
      : finished ? <div className="amazon-reasoning"><p role="status">{sending || pending ? 'Preparando las preguntas que aún necesitan tu respuesta…' : 'La revisión está lista. Continuemos con los datos actuales.'}</p>
        <button type="button" disabled={sending || pending} onClick={() => prepare()}><Icon name="uony" size={18} />Continuar con Uony</button></div>
        : <AmazonReasoningStatus key={`${reasoning.id}:${reasoning.status}`} reasoning={reasoning} disabled={pending || sending || query.isPending}
          onRetry={acknowledged => prepare(true, acknowledged)} />}
    {error && <p role="alert">{error}</p>}
  </section>, questionTarget);
}
