/**
 * Plantilla de la nota interna de un ticket, adaptada de la de Rentprivé
 * (hubspot_lead_service.py · _build_note_body). Minimización: sin identificadores
 * publicitarios ni UTM; solo los datos reales del ticket y, como contexto para el
 * equipo, los últimos mensajes con Uony ya tachados.
 */
import { TICKET_CATEGORIES, TICKET_SOURCES, TRANSCRIPT_CHARS } from '../model/tickets';
import type { Ticket } from '../model/types';

const dash = (value: string | null | undefined) => (value && value.trim() ? value.trim() : '—');

export function buildTicketNote(ticket: Pick<Ticket, 'id' | 'number' | 'subject' | 'category' | 'source' | 'createdAt' | 'messages' | 'transcript'>, conversationId: string | null): string {
  const first = ticket.messages[0];
  const lines = [
    '[TICKET · SOPORTE UONIFY]',
    '',
    `Ticket: ${ticket.number} (${ticket.id})`,
    `Asunto: ${dash(ticket.subject)}`,
    `Tema: ${TICKET_CATEGORIES[ticket.category]}`,
    `Origen: ${TICKET_SOURCES[ticket.source]}`,
    `Creado: ${ticket.createdAt}`,
    `Conversación con Uony: ${dash(conversationId)}`,
    '',
    'Mensaje',
    dash(first?.body),
  ];
  if (ticket.transcript.length) {
    lines.push('', `Mensajes con Uony adjuntos: ${ticket.transcript.length}`);
    for (const turn of ticket.transcript.slice(-5)) {
      lines.push(`  [${turn.role === 'user' ? 'cliente' : 'uony'}] ${turn.text.slice(0, TRANSCRIPT_CHARS)}`);
    }
  }
  return lines.join('\n');
}
