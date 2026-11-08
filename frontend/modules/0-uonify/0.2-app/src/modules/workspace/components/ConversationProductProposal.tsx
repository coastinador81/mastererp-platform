import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentAccountEmail } from '@/modules/auth';
import { Icon } from '@/shared/ui';
import { beginProductProposalDecision, readProductProposalDecisionIntent,
  reconcileProductProposalDecision, submitProductProposalDecision,
  type ProductProposalDecisionIntent, type ProductProposalDecisionOutcome } from '../api/productProposalDecisionIntent';
import { getProductProposal, type ProductProposalDecision,
  type ProductProposalReceipt } from '../api/productProposals';
import type { ProductProposal } from '../model/productProposal';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import '../styles/conversation-product-proposal.css';

interface Props {
  account: string;
  threadId: string;
  proposal: ProductProposal;
  originalText: string;
  /** Refresca el catálogo tras un recibo propio y verificado. */
  onConfirmed?: (receipt: ProductProposalReceipt) => void;
}

const FIELD_LABELS = {
  name: 'Nombre', sku: 'SKU', brand: 'Marca', category: 'Categoría',
  description: 'Descripción', keywords: 'Palabras clave', price: 'Precio',
  cost: 'Coste', stock: 'Existencias', bullets: 'Puntos destacados',
  customFields: 'Campos personalizados',
} as const;
type FieldKey = keyof typeof FIELD_LABELS;
const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];
const CUSTOM_LABELS: Record<string, string> = {
  id: 'Identificador', name: 'Nombre', value: 'Valor', type: 'Tipo',
  options: 'Opciones', isConfirmed: 'Confirmado', isDefault: 'Predeterminado', source: 'Origen',
};

/** Si un dato no puede enseñarse completo, no se ofrece su aprobación. */
function visibleFields(proposal: ProductProposal): { key: FieldKey; text: string }[] | null {
  const payload = proposal.payload;
  const allowed = new Set<string>([...FIELD_KEYS, ...(proposal.action === 'update' ? ['revision'] : [])]);
  if (Object.keys(payload).some(key => !allowed.has(key))
    || (proposal.action === 'update' && payload.revision !== proposal.baseRevision)) return null;
  const rows: { key: FieldKey; text: string }[] = [];
  for (const key of FIELD_KEYS) {
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (key === 'bullets') {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return null;
      rows.push({ key, text: value.map((item, index) => `${index + 1}. ${item}`).join('\n') || 'Sin puntos destacados' });
    } else if (key === 'customFields') {
      if (!Array.isArray(value)) return null;
      const lines: string[] = [];
      for (const [index, item] of value.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const fields = item as Record<string, unknown>;
        if (Object.keys(fields).some(field => !Object.hasOwn(CUSTOM_LABELS, field))) return null;
        const values: string[] = [];
        for (const [field, content] of Object.entries(fields)) {
          if (field === 'options') {
            if (!Array.isArray(content) || !content.every(option => typeof option === 'string')) return null;
            values.push(`${CUSTOM_LABELS[field]}: ${JSON.stringify(content)}`);
          } else {
            if (content !== null && !['string', 'number', 'boolean'].includes(typeof content)) return null;
            values.push(`${CUSTOM_LABELS[field]}: ${String(content)}`);
          }
        }
        lines.push(`${index + 1}. ${values.join(' · ')}`);
      }
      rows.push({ key, text: lines.join('\n') || 'Sin campos personalizados' });
    } else {
      if (typeof value !== 'string' && (typeof value !== 'number'
        || !['price', 'cost', 'stock'].includes(key))) return null;
      rows.push({ key, text: String(value) });
    }
  }
  return rows.length ? rows : null;
}

type Display =
  | { kind: 'checking' }
  | { kind: 'pending'; current: ProductProposal; intent: ProductProposalDecisionIntent | null }
  | { kind: 'working'; action: ProductProposalDecision }
  | { kind: 'decided'; current: ProductProposal }
  | { kind: 'attention'; message: string; retry: 'check' | 'refresh' };

function sameReview(left: ProductProposal, right: ProductProposal): boolean {
  return left.proposalId === right.proposalId && left.threadId === right.threadId
    && left.action === right.action && left.targetSku === right.targetSku
    && left.proposalHash === right.proposalHash && left.baseRevision === right.baseRevision;
}

function productName(proposal: ProductProposal): string {
  const name = proposal.payload.name;
  return typeof name === 'string' && name.trim() ? name.trim() : proposal.targetSku;
}

function decisionText(proposal: ProductProposal): string {
  const name = productName(proposal);
  if (proposal.status === 'approved') return proposal.action === 'create'
    ? `Listo, guardé el borrador de ${name} en Uonify. Podemos seguir aquí.`
    : `Listo, guardé los cambios de ${name} en Uonify. Podemos seguir aquí.`;
  if (proposal.status === 'rejected') return proposal.action === 'create'
    ? 'Entendido, descarté la propuesta. No se ha creado ninguna ficha. Dime qué quieres cambiar.'
    : 'Entendido, descarté la propuesta. No se han guardado cambios. Dime qué quieres cambiar.';
  return 'He cerrado la propuesta sin guardar cambios. Podemos seguir aquí.';
}

/** La tarjeta solo ofrece acciones tras releer la propuesta del servidor. */
export function ConversationProductProposal({ account, threadId, proposal, originalText,
  onConfirmed }: Props) {
  const [display, setDisplay] = useState<Display>({ kind: 'checking' });
  const generation = useRef(0);
  const focusAfterDecision = useRef(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const notified = useRef<string | null>(null);
  const historyEpoch = useWorkspaceStore(state => state.historyEpoch);
  const scope = useMemo(() => ({ account, threadId, proposalId: proposal.proposalId }),
    [account, threadId, proposal.proposalId]);
  const isCurrent = useCallback(() => {
    const workspace = useWorkspaceStore.getState();
    return currentAccountEmail() === account && workspace.activeThreadId === threadId
      && workspace.historyAccount === account && workspace.historyEpoch === historyEpoch;
  }, [account, threadId, historyEpoch]);

  const applyOutcome = useCallback((outcome: ProductProposalDecisionOutcome,
    intent: ProductProposalDecisionIntent, refreshHistory = false) => {
    if (!isCurrent()) return;
    if (outcome.state === 'unavailable') {
      setDisplay({ kind: 'attention', message: 'No hemos podido comprobar la decisión. Tu elección se conserva; vuelve a consultar su estado.', retry: 'check' });
      return;
    }
    if (!sameReview(outcome.proposal, proposal)) {
      setDisplay({ kind: 'attention', message: 'La propuesta ha cambiado. Actualiza la conversación antes de decidir.', retry: 'refresh' });
      return;
    }
    if (outcome.state === 'confirmed') {
      setDisplay({ kind: 'decided', current: { ...outcome.proposal, status: outcome.receipt.status } });
      if (outcome.receipt.status === 'approved' && notified.current !== outcome.receipt.requestId) {
        notified.current = outcome.receipt.requestId;
        onConfirmed?.(outcome.receipt);
      }
      if (refreshHistory) useWorkspaceStore.getState().retryHistory?.();
    } else if (outcome.state === 'pending' && intent.phase === 'prepared') {
      setDisplay(visibleFields(outcome.proposal)
        ? { kind: 'pending', current: outcome.proposal, intent }
        : { kind: 'attention', message: 'No podemos mostrar todos los datos de esta propuesta. Pide a Uony que prepare otra antes de guardarla.', retry: 'refresh' });
    } else if (outcome.state === 'decided_elsewhere') {
      setDisplay({ kind: 'decided', current: outcome.proposal });
      if (refreshHistory) useWorkspaceStore.getState().retryHistory?.();
    } else if (outcome.state === 'uncertain' || outcome.state === 'pending') {
      setDisplay({ kind: 'attention', message: 'Todavía no sabemos si se registró tu decisión. No volveremos a enviarla; consulta su estado.', retry: 'check' });
    } else {
      setDisplay({ kind: 'attention', message: outcome.state === 'changed'
        ? 'La propuesta ha cambiado. Actualiza la conversación antes de decidir.'
        : 'No hemos podido verificar el resultado. Consulta el estado antes de continuar.',
      retry: outcome.state === 'changed' ? 'refresh' : 'check' });
    }
  }, [isCurrent, onConfirmed, proposal]);

  const check = useCallback(async (signal?: AbortSignal) => {
    await Promise.resolve();
    if (signal?.aborted) return;
    const currentGeneration = ++generation.current;
    if (!isCurrent()) {
      setDisplay({ kind: 'attention', message: 'Recupera esta conversación con tu cuenta para revisar la propuesta.', retry: 'refresh' });
      return;
    }
    const intent = readProductProposalDecisionIntent(scope);
    try {
      if (intent) {
        const outcome = await reconcileProductProposalDecision(intent, signal);
        if (signal?.aborted || currentGeneration !== generation.current || !isCurrent()) return;
        applyOutcome(outcome, intent);
        return;
      }
      const current = await getProductProposal(proposal.proposalId, threadId, signal);
      if (signal?.aborted || currentGeneration !== generation.current || !isCurrent()) return;
      if (!sameReview(current, proposal)) {
        setDisplay({ kind: 'attention', message: 'La propuesta ha cambiado. Actualiza la conversación antes de decidir.', retry: 'refresh' });
      } else if (current.status === 'pending') {
        setDisplay(visibleFields(current)
          ? { kind: 'pending', current, intent: null }
          : { kind: 'attention', message: 'No podemos mostrar todos los datos de esta propuesta. Pide a Uony que prepare otra antes de guardarla.', retry: 'refresh' });
      } else {
        setDisplay({ kind: 'decided', current });
      }
    } catch {
      if (!signal?.aborted && currentGeneration === generation.current && isCurrent()) {
        setDisplay({ kind: 'attention', message: 'No hemos podido comprobar esta propuesta. Vuelve a consultar su estado.', retry: 'check' });
      }
    }
  }, [threadId, proposal, scope, isCurrent, applyOutcome]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => check(controller.signal));
    return () => { controller.abort(); generation.current += 1; };
  }, [check]);

  useEffect(() => {
    if (focusAfterDecision.current && (display.kind === 'decided' || display.kind === 'attention')) {
      focusAfterDecision.current = false;
      messageRef.current?.focus({ preventScroll: true });
    }
  }, [display]);

  const decide = async (action: ProductProposalDecision) => {
    if (display.kind !== 'pending' || !sameReview(display.current, proposal) || !isCurrent()) return;
    generation.current += 1;
    focusAfterDecision.current = true;
    setDisplay({ kind: 'working', action });
    try {
      const intent = await beginProductProposalDecision(scope, action, display.current.proposalHash);
      if (!isCurrent()) return;
      if (!intent) {
        setDisplay({ kind: 'attention', message: 'No hemos podido confirmar la propuesta que revisaste. Consulta su estado antes de continuar.', retry: 'check' });
        return;
      }
      const outcome = await submitProductProposalDecision(intent);
      if (!isCurrent()) return;
      applyOutcome(outcome, intent, true);
    } catch {
      if (!isCurrent()) return;
      setDisplay({ kind: 'attention', message: 'No hemos podido completar la comprobación. Tu elección se conserva; consulta su estado antes de continuar.', retry: 'check' });
    }
  };

  const shown: Display = (display.kind === 'pending' || display.kind === 'decided')
    && !sameReview(display.current, proposal) ? { kind: 'checking' } : display;
  const title = proposal.action === 'create' ? 'Crear borrador' : 'Guardar cambios';
  const pendingIntent = shown.kind === 'pending' ? shown.intent : null;
  const decided = shown.kind === 'decided';
  const fields = shown.kind === 'pending' ? visibleFields(shown.current) : null;
  return <div className="conversation-product-proposal-response">
    <Icon name="uony" size={20} />
    <div className="conversation-product-proposal-body">
      {shown.kind === 'pending' && <>
        <p>{originalText}</p>
        <section className="conversation-product-proposal-card" aria-label="Propuesta de ficha">
          <span className="conversation-product-proposal-eyebrow">Tu confirmación</span>
          <strong>{title} · {productName(shown.current)}</strong>
          <dl><div><dt>Producto</dt><dd>{productName(shown.current)}</dd></div>
            <div><dt>Origen</dt><dd>Esta conversación</dd></div></dl>
          {fields && <details className="conversation-product-proposal-details">
            <summary>Ver datos que se guardarán</summary>
            <dl>{fields.map(field => <div key={field.key}>
              <dt>{FIELD_LABELS[field.key]}</dt><dd>{field.text}</dd>
            </div>)}</dl>
          </details>}
          <p>{proposal.action === 'create'
            ? 'Al confirmar se guardará esta ficha en Uonify. No se analizarán archivos ni se publicará en Amazon.'
            : 'Al confirmar se guardarán estos cambios en Uonify. No se analizarán archivos ni se publicará en Amazon.'}</p>
          {pendingIntent?.phase === 'prepared' && <p role="status">Tu decisión anterior está preparada. Puedes continuarla con la misma confirmación.</p>}
          <div className="conversation-product-proposal-actions">
            {(!pendingIntent || pendingIntent.action === 'approve') && <button type="button" className="conversation-product-proposal-primary"
              onClick={() => void decide('approve')}>{pendingIntent ? 'Continuar confirmación' : title}</button>}
            {(!pendingIntent || pendingIntent.action === 'reject') && <button type="button" className="conversation-product-proposal-secondary"
              onClick={() => void decide('reject')}>Descartar propuesta</button>}
          </div>
        </section>
      </>}
      {decided && <p ref={messageRef} tabIndex={-1} role="status">{decisionText(shown.current)}</p>}
      {shown.kind === 'checking' && <p role="status">Comprobando esta propuesta…</p>}
      {shown.kind === 'working' && <p role="status">{shown.action === 'approve' ? 'Guardando tu decisión…' : 'Descartando la propuesta…'}</p>}
      {shown.kind === 'attention' && <div className="conversation-product-proposal-attention">
        <p ref={messageRef} tabIndex={-1} role="status">{shown.message}</p>
        <button type="button" onClick={() => {
          if (shown.retry === 'refresh') useWorkspaceStore.getState().retryHistory?.();
          setDisplay({ kind: 'checking' });
          void check();
        }}>{shown.retry === 'refresh' ? 'Actualizar conversación' : 'Comprobar estado'}</button>
      </div>}
    </div>
  </div>;
}
