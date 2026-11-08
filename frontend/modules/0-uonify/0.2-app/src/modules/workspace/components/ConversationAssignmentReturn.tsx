import { useState } from 'react';
import type { AssignmentReturn, AssignmentReturnItem } from '../api/assignmentReturn';

const statusText: Record<string, string> = {
  pending: 'Pendiente', waiting_authorization: 'Esperando tu autorización',
  in_progress: 'En curso', completed: 'Terminado', failed: 'Con una incidencia',
};

const nextStepText: Record<string, string> = {
  clarify_source: 'Aclarar si tienes materiales o partes de cero.',
  select_product: 'Identificar la ficha que corresponde a este encargo.',
  select_folder: 'Elegir los materiales de la revisión actual.',
  await_authorization: 'Revisar la acción antes de autorizarla.',
  check_work: 'Consultar el estado del trabajo guardado.',
  review_result: 'Revisar el resultado guardado.',
  none: 'No hay un paso pendiente registrado.',
};

function workState(status: string): string {
  return ({ queued: 'en cola', running: 'en curso', ready: 'listo para revisar',
    paused: 'en pausa', error: 'con una incidencia', unknown: 'por comprobar',
    completed: 'terminado' } as Record<string, string>)[status] ?? 'por comprobar';
}

function WorkEvidence({ item }: { item: AssignmentReturnItem }) {
  const own = item.assignmentWork;
  const related = item.relatedProductWork;
  return <>
    {own ? <p className="conversation-followup-state-note">{own.currentRevision
      ? `Análisis iniciado para este encargo: ${workState(own.status)}.`
      : 'El análisis de este encargo corresponde a una revisión anterior; no acredita el estado actual.'}</p>
      : <p className="conversation-followup-state-note">No consta un análisis iniciado para este encargo.</p>}
    {related && <p className="conversation-followup-state-note">En la ficha vinculada hay {related.kind === 'materials'
      ? 'un análisis de materiales' : 'una revisión de IA'} {workState(related.status)}.
      Ese trabajo no se inició para este encargo.</p>}
  </>;
}

export function ConversationAssignmentReturn({ view, onSelect, onRefresh, busy, lockedId, uncertain, conflict, notice }: {
  view: AssignmentReturn; onSelect: (assignmentId: string) => void; onRefresh: () => void;
  busy: boolean; lockedId: string | null; uncertain: boolean; conflict: boolean; notice: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = view.assignments;
  const ambiguous = view.resolution === 'ambiguous' && items.length > 1;
  const selected = items.find(item => item.assignment.id === (lockedId ?? selectedId))
    ?? (ambiguous ? null : items[0]);
  const lockedMissing = !!lockedId && !items.some(item => item.assignment.id === lockedId);
  // Varios encargos pueden compartir un rótulo genérico («Producto en Amazon») y salían como botones IDÉNTICOS
  // («Ver Producto en Amazon» ×2). Desambiguamos el texto del selector: si el rótulo se repite, añadimos la ficha
  // vinculada (o su estado); y como última garantía un ordinal, para que nunca haya dos botones indistinguibles.
  const labelCounts = new Map<string, number>();
  for (const item of items) labelCounts.set(item.assignment.label, (labelCounts.get(item.assignment.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const selectorLabels = items.map(item => {
    let label = item.assignment.label;
    if ((labelCounts.get(label) ?? 0) > 1) {
      const extra = item.product?.name && item.product.name !== label ? item.product.name : statusText[item.assignment.status];
      if (extra) label = `${label} · ${extra}`;
    }
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n > 1 ? `${label} · ${n}` : label;
  });
  return <section className="conversation-followup-card" aria-label="Tus encargos guardados">
    <h2>{ambiguous ? 'Encargos guardados' : 'En el hilo'}</h2>
    {ambiguous && <p>Elige qué encargo quieres continuar. Ver su estado no inicia trabajo ni envía mensajes a Uony.</p>}
    {items.length > 1 && <div className="conversation-followup-actions" aria-label="Encargos guardados">
      {items.map((item, idx) => <button key={item.assignment.id} type="button" className="conversation-followup-secondary"
        aria-pressed={selected?.assignment.id === item.assignment.id}
        disabled={busy || (!!lockedId && lockedId !== item.assignment.id)}
        onClick={() => setSelectedId(item.assignment.id)}>
        Ver {selectorLabels[idx]}
      </button>)}
    </div>}
    {selected && <><p><strong>{selected.assignment.label}</strong> · {statusText[selected.assignment.status] ?? 'Estado por comprobar'}.</p>
    <p className="conversation-followup-next"><strong>Siguiente paso:</strong> {nextStepText[selected.assignment.nextStep]
      ?? 'Comprobar el siguiente paso guardado.'}</p>
    <WorkEvidence item={selected} /></>}
    {view.moreAvailable && <p className="conversation-followup-state-note">Hay más encargos guardados.</p>}
    {notice && <p role="status">{notice}</p>}
    {(selected || lockedMissing || conflict) && <div className="conversation-followup-actions"><button type="button" disabled={busy}
      onClick={conflict ? onRefresh : () => onSelect(lockedId ?? selected!.assignment.id)}>
      {busy ? 'Comprobando…' : conflict ? 'Actualizar encargos →' : uncertain || lockedMissing
        ? 'Comprobar selección →' : 'Continuar en esta conversación →'}
    </button></div>}
  </section>;
}
