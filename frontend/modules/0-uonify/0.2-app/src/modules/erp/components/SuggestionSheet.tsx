import { useState } from 'react';
import { useSuggestions } from '../hooks/useSuggestions';
import { nodeName } from '../model/demoPurchases';
import { FINANCE_ICON_PATHS } from '../model/menu';
import {
  bolivares,
  changedProposal,
  cleanProposal,
  proposalOf,
  suggestionReference,
  validateProposal,
  type ProposalDraft,
  type Suggestion,
} from '../model/suggestions';
import { Fields, Section, SheetHeader } from './SheetParts';
import { SuggestionComparison } from './SuggestionComparison';
import { SuggestionReview } from './SuggestionReview';

export interface SuggestionSheetProps {
  suggestion: Suggestion;
  onClose: (detail: number) => void;
  /** Tras la aprobación del Jefe de compras: abre el borrador creado en Compras. */
  onApproved: (reference: string) => void;
}

/**
 * Ficha de una sugerencia de compra en el centro de la mesa, con el contenido y el flujo de
 * la demo del equipo (PurchaseSuggestionsPreview.jsx): detalle, comparación de versiones y
 * las dos revisiones. Montarla con key por sugerencia: la confirmación y el error son suyos.
 */
export function SuggestionSheet({ suggestion, onClose, onApproved }: SuggestionSheetProps) {
  const { notes, drafts, nodeReviews, approved, setNote, setDraft, reviewByNode, approve } = useSuggestions();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const reference = suggestionReference(suggestion);
  const nodeReview = nodeReviews[suggestion.id];
  const nodeDone = Boolean(nodeReview);
  const completed = approved.find(row => row.source === reference);
  const original = proposalOf(suggestion);
  const draftKey = `${suggestion.id}:${nodeDone ? 'purchasing' : 'node'}`;
  const draft: ProposalDraft = completed?.fromSuggestion
    ? { ...proposalOf(completed.fromSuggestion.final), priority: completed.fromSuggestion.priority, purchasingNote: completed.fromSuggestion.purchasingObservation }
    : drafts[draftKey] ?? { ...proposalOf(nodeReview?.proposal ?? suggestion), priority: false, purchasingNote: '' };
  const valid = !validateProposal(draft);

  const update = (patch: Partial<ProposalDraft>) => {
    setDraft(draftKey, { ...draft, ...patch });
    setConfirmed(false);
    setError('');
  };

  const confirm = () => {
    const message = validateProposal(draft);
    if (message) {
      setError(message);
      return;
    }
    if (!confirmed) return;
    const proposal = cleanProposal(draft);
    if (nodeDone) {
      const created = approve(suggestion, { ...proposal, priority: Boolean(draft.priority), purchasingNote: draft.purchasingNote ?? '' });
      if (created) onApproved(created);
      return;
    }
    reviewByNode(suggestion, proposal, cleanProposal(original));
    setConfirmed(false);
    setError('');
    // El botón se desactiva: el foco pasa al primer campo de la revisión del Jefe de compras.
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-erp-review-start]')?.focus());
  };

  return (
    <div className="product-editor-layout erp-sheet">
      <SheetHeader
        icon={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: FINANCE_ICON_PATHS.summary }} />}
        title={`Compra sugerida · ${reference}`}
        subtitle="Revisión del nodo → Jefe de compras → Compras."
        status="DEMO · IA no conectada"
        closeLabel="Volver a sugerencias"
        onClose={onClose}
      />
      <div className="product-editor-surface pim-tab">
        <Section title="Detalle de la propuesta" note="Impuestos, descuentos y condiciones de entrega: sin definir.">
          <Fields items={[
            ['Nodo de destino', nodeName(suggestion.node)],
            ['Proveedor sugerido', suggestion.supplier],
            ['Origen', 'Ejemplo de reposición por stock · sin algoritmo'],
            ['Moneda', 'Bolívares (Bs.)'],
          ]} />
          <div className="erp-table-scroll">
            <table className="erp-table erp-table-narrow">
              <thead>
                <tr>{['Producto', 'Stock de ejemplo', 'Cantidad propuesta', 'Unidad', 'Precio estimado', 'Total estimado'].map(label => <th scope="col" key={label}>{label}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <td>{suggestion.product}</td>
                  <td className="erp-num">{suggestion.stock}</td>
                  <td className="erp-num">{suggestion.quantity}</td>
                  <td>Unidad</td>
                  <td className="erp-num pim-mono">{bolivares(suggestion.price)}</td>
                  <td className="erp-num pim-mono">{bolivares(suggestion.quantity * suggestion.price)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
        <SuggestionComparison
          original={cleanProposal(original)}
          node={nodeReview?.proposal}
          final={completed?.fromSuggestion?.final}
          draft={valid ? cleanProposal(draft) : null}
          draftStage={completed ? null : nodeDone ? 'purchasing' : 'node'}
        />
        <SuggestionReview
          nodeDone={nodeDone}
          nodeChanged={nodeReview ? changedProposal(original, nodeReview.proposal) : false}
          nodeReviewedAt={nodeReview?.at}
          nodeNote={nodeDone ? nodeReview.note : notes[suggestion.id] ?? ''}
          completed={completed}
          draft={draft}
          valid={valid}
          confirmed={confirmed}
          error={error}
          onUpdate={update}
          onNoteChange={note => {
            setNote(suggestion.id, note);
            setConfirmed(false);
          }}
          onConfirmedChange={setConfirmed}
          onConfirm={confirm}
        />
        <p className="pim-section-sub erp-note">
          Stock, cantidades y precios ficticios. Dos revisiones visuales sin autenticación ni permisos reales; IA y reglas pendientes. Solo memoria de esta pestaña: al recargar se pierden observaciones, revisiones y borradores. No se envían órdenes ni se genera deuda.
        </p>
      </div>
    </div>
  );
}
