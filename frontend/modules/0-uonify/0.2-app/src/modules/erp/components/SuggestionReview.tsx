import { Button, Checkbox, ErrorText, Field, Input, Textarea } from '@/shared/ui';
import type { DemoPurchase } from '../model/demoPurchases';
import { bolivares, reviewTime, totalOf, type ProposalDraft } from '../model/suggestions';
import { Fields, Section } from './SheetParts';

export interface SuggestionReviewProps {
  nodeDone: boolean;
  nodeChanged: boolean;
  nodeReviewedAt?: string;
  nodeNote: string;
  completed?: DemoPurchase;
  draft: ProposalDraft;
  valid: boolean;
  confirmed: boolean;
  error: string;
  onUpdate: (patch: Partial<ProposalDraft>) => void;
  onNoteChange: (note: string) => void;
  onConfirmedChange: (confirmed: boolean) => void;
  onConfirm: () => void;
}

/**
 * Las dos revisiones de una sugerencia, con los textos literales de la demo del equipo
 * (PurchaseSuggestionsPreview.jsx): ajustes del Jefe de nodo o del Jefe de compras,
 * decisión final, observaciones del nodo y la confirmación de cada revisión.
 */
export function SuggestionReview(props: SuggestionReviewProps) {
  const { nodeDone, nodeChanged, completed, draft, valid, confirmed, error } = props;
  const approved = Boolean(completed);
  const final = completed?.fromSuggestion;
  return (
    <>
      {approved ? (
        <Section title="Decisión final">
          <p className="erp-note">{final?.priority ? 'Compra prioritaria' : 'Prioridad normal'}</p>
          <p className="erp-note">{final?.purchasingObservation || 'Sin observaciones del Jefe de compras'}</p>
        </Section>
      ) : (
        <Section
          title={nodeDone ? 'Ajustes del Jefe de compras' : 'Validación y ajustes del Jefe de nodo'}
          note="Ajustes DEMO del producto propuesto. No cambia el stock ni la recomendación original."
        >
          {nodeDone && nodeChanged ? (
            <p className="erp-notice" role="status">El nodo modificó la recomendación. Revisa las diferencias antes de aprobar y decide si requiere prioridad.</p>
          ) : null}
          <div className="erp-review-fields">
            <Field label="Cantidad a comprar">
              <Input data-erp-review-start="" type="number" min={1} max={1000000} step={1} value={draft.quantity} onChange={event => props.onUpdate({ quantity: event.target.value })} />
            </Field>
            <Field label="Precio unitario estimado (Bs.)">
              <Input type="number" min={0.01} max={1000000} step={0.01} value={draft.price} onChange={event => props.onUpdate({ price: event.target.value })} />
            </Field>
            <Field label="Proveedor propuesto">
              <Input maxLength={160} value={draft.supplier} onChange={event => props.onUpdate({ supplier: event.target.value })} />
            </Field>
            <div className="pim-field">
              <span className="pim-label">Total ajustado</span>
              <p className="pim-mono erp-review-total">{valid ? bolivares(totalOf(draft)) : 'Revisa los importes'}</p>
            </div>
          </div>
          {nodeDone ? (
            <>
              <Checkbox
                label="Marcar como compra prioritaria"
                checked={Boolean(draft.priority)}
                onCheckedChange={checked => props.onUpdate({ priority: checked })}
              />
              <Field label="Observaciones del Jefe de compras">
                <Textarea rows={3} maxLength={2000} value={draft.purchasingNote ?? ''} onChange={event => props.onUpdate({ purchasingNote: event.target.value })} />
              </Field>
            </>
          ) : null}
        </Section>
      )}
      <Section title="Observaciones del Jefe de nodo">
        <Field label="Observaciones" hint={nodeDone ? 'Observaciones conservadas con la revisión del nodo.' : 'Opcional · se conservarán al enviar la propuesta al jefe de compras.'}>
          <Textarea
            rows={4}
            maxLength={2000}
            placeholder="Indica necesidades del nodo, prioridades o aclaraciones de esta propuesta."
            value={props.nodeNote}
            readOnly={nodeDone}
            onChange={event => props.onNoteChange(event.target.value)}
          />
        </Field>
      </Section>
      <Section title={approved ? 'Revisiones completadas' : nodeDone ? '2. Revisión del Jefe de compras' : '1. Revisión del Jefe de nodo'}>
        <Fields items={[
          ['Fecha y hora · revisión del nodo', reviewTime(props.nodeReviewedAt)],
          ['Fecha y hora · Jefe de compras', reviewTime(final?.approvedAt)],
        ]} />
        <p className="pim-section-sub erp-note">Hora local del navegador · registro DEMO.</p>
        <p className="erp-note">
          {approved
            ? 'Esta sugerencia ya pasó a Compras como borrador.'
            : nodeDone
              ? 'Revisa la propuesta y las observaciones del Jefe de nodo antes de aprobar.'
              : 'Comprueba la necesidad, las cantidades y el destino antes de enviar al Jefe de compras.'}
        </p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {approved ? null : (
          <div className="erp-review-confirm">
            <Checkbox label="Confirmo la revisión de esta propuesta DEMO." checked={confirmed} onCheckedChange={props.onConfirmedChange} />
            <div className="pim-section-actions">
              <Button type="button" variant="primary" disabled={!confirmed} onClick={props.onConfirm}>
                {nodeDone ? 'Aprobar y pasar a Compras' : 'Validar y enviar al jefe de compras'}
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
