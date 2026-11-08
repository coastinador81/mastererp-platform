import type { PreparationField } from '../api/preparation';

/** Solo tras revisar el conflicto: adapta el borrador al esquema vigente sin ocultar respuestas retiradas. */
export function reconcilePreparationAnswers(fields: PreparationField[], answers: Record<string, string>) {
  const consumed = new Set<string>();
  const next = Object.fromEntries(fields.map(field => {
    const original = field.id.endsWith('_notes') ? field.id.slice(0, -6) : field.id;
    const source = Object.hasOwn(answers, field.id) ? field.id : Object.hasOwn(answers, original) ? original : null;
    if (source) consumed.add(source);
    return [field.id, source ? answers[source] : field.value];
  }));
  return { answers: next, previousAnswers: Object.entries(answers).filter(([id, value]) => !consumed.has(id) && value.trim()).map(([, value]) => value) };
}
