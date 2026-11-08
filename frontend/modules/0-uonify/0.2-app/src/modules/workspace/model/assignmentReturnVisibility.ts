import type { AssignmentReturn } from '../api/assignmentReturn';
import type { ChatMessage } from './workspaceState';

/** Los encargos de la cuenta solo entran en otro hilo cuando la persona pide retomarlos. */
export function requestsAssignmentReturn(messages: readonly ChatMessage[]): boolean {
  const lastUser = [...messages].reverse().find(message => message.role === 'user');
  if (!lastUser) return false;
  const text = lastUser.text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const assignment = /\b(encargos?|trabajos?|tareas?)\b/.test(text);
  const product = /\b(productos?|fichas?)\b/.test(text);
  const prior = /\b(anteriores?|pendientes?|guardados?)\b/.test(text);
  const resumption = /\b(retom[a-z]*|reanud[a-z]*|continu[a-z]*|sigue|sigamos|volvamos|vuelve)\b/.test(text);
  // Drive puede describir el encargo a retomar, pero preguntar por acceso no lo selecciona.
  if (/\b(drive|conexiones?|acceso|carpetas?|archivos?|documentos?)\b/.test(text)
    && !((assignment || product) && resumption)) return false;
  const browseAssignments = /\b(muestr[a-z]*|ensen[a-z]*|list[a-z]*|ver)\b/.test(text)
    || /\b(?:que|cuales)\s+(?:encargos?|trabajos?|tareas?)\b/.test(text);
  return (assignment && (resumption || browseAssignments)) || (product && (resumption || prior && browseAssignments));
}

export function showAssignmentReturn(view: AssignmentReturn, messages: readonly ChatMessage[]): boolean {
  return view.resolution === 'focused' && view.focusVersion > 0 || requestsAssignmentReturn(messages);
}
