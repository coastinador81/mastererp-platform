/**
 * Simulación de /support/* (contrato en api/paths.ts): tickets y videollamadas
 * de pago con Google Meet. El asistente está en assistantHandler.ts.
 */
import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { SUPPORT_PATHS } from '../api/paths';
import { redactSensitive } from '../model/assistant/redact';
import { BOOKING_TOPICS, cancelCheck, generateSlotDays, HOLD_MINUTES, isValidSlot, meetCode } from '../model/booking';
import { isTicketCategory, sortTickets, trimTranscript, validateTicket } from '../model/tickets';
import type { Booking, BookingTopic, SlotsResponse, TicketInput, TicketMessage, TicketSource, TranscriptTurn } from '../model/types';
import { bookingsDb, configDb, counterDb, idempotencyDb, publicTicket, ticketsDb, type StoredTicket } from './store';
import { buildTicketNote } from './ticketNote';

const TEAM = 'Equipo de Uonify';
const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function remembered(key: string | null, scope: string): string | undefined {
  return key ? idempotencyDb.get()[`${scope}:${key}`] : undefined;
}

function remember(key: string | null, scope: string, id: string): void {
  if (key) idempotencyDb.update(map => ({ ...map, [`${scope}:${key}`]: id }));
}

function summary(ticket: StoredTicket) {
  const { messages: _messages, transcript: _transcript, ...rest } = publicTicket(ticket);
  return rest;
}

function withMessage(ticket: StoredTicket, message: TicketMessage, status: StoredTicket['status']): StoredTicket {
  return { ...ticket, messages: [...ticket.messages, message], status, updatedAt: message.createdAt, lastMessage: message.body, unread: message.author === 'team' };
}

function cleanTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  const turns = value
    .filter((turn): turn is TranscriptTurn => !!turn && typeof turn === 'object' && (turn.role === 'user' || turn.role === 'uony') && typeof turn.text === 'string')
    .map(turn => ({ role: turn.role, text: redactSensitive(turn.text).text }));
  return trimTranscript(turns);
}

/** Estados que dependen de la hora: huecos sin pagar caducan y las sesiones pasadas se celebran. */
function refreshBookings(now: number): Booking[] {
  return bookingsDb.all().map(booking => {
    if (booking.status === 'pending_payment' && booking.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() < now) {
      return bookingsDb.patch(booking.id, { status: 'expired' }) ?? booking;
    }
    if (booking.status === 'confirmed' && new Date(booking.end).getTime() < now) return bookingsDb.patch(booking.id, { status: 'completed' }) ?? booking;
    return booking;
  });
}

/** Agenda del equipo simulada: algunos huecos ya están ocupados (siempre los mismos). */
function busy(iso: string): boolean {
  let hash = 0;
  for (const char of iso) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 3 === 0;
}

function takenStarts(bookings: Booking[]): Set<string> {
  return new Set(bookings.filter(b => b.status === 'confirmed' || b.status === 'pending_payment').map(b => new Date(b.start).toISOString()));
}

const isTopic = (value: unknown): value is BookingTopic => typeof value === 'string' && value in BOOKING_TOPICS;
const SOURCES: TicketSource[] = ['uony', 'form', 'email', 'videocall'];

export const supportHandlers = [
  http.get(mock(SUPPORT_PATHS.tickets), async () => {
    await latency(250);
    return HttpResponse.json(sortTickets(ticketsDb.all()).map(summary));
  }),

  http.post(mock(SUPPORT_PATHS.tickets), async ({ request }) => {
    await latency(400);
    const key = request.headers.get('Idempotency-Key');
    const existing = remembered(key, 'ticket');
    if (existing && ticketsDb.get(existing)) return HttpResponse.json(publicTicket(ticketsDb.get(existing)!), { status: 200 });
    const body = (await request.json().catch(() => null)) as Partial<TicketInput> | null;
    const input = {
      subject: typeof body?.subject === 'string' ? body.subject : '',
      message: typeof body?.message === 'string' ? body.message : '',
      category: isTicketCategory(body?.category) ? body.category : ('' as never),
    };
    const errors = validateTicket(input);
    const firstError = Object.values(errors)[0];
    if (firstError) return fail(400, firstError, 'invalid_ticket');
    const now = nowIso();
    const counter = counterDb.update(c => ({ ...c, ticket: c.ticket + 1 }));
    const id = `tkt-${counter.ticket}`;
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    const message = redactSensitive(input.message.trim()).text;
    const ticket: StoredTicket = {
      id,
      number: `UON-${counter.ticket}`,
      subject: redactSensitive(input.subject.trim()).text,
      category: input.category,
      source: SOURCES.includes(body?.source as TicketSource) ? (body!.source as TicketSource) : 'form',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      lastMessage: message,
      unread: false,
      transcript: cleanTranscript(body?.transcript),
      messages: [{ id: newId('msg'), author: 'customer', authorName: 'Cliente', body: message, createdAt: now }],
      internalNote: '',
      conversationId,
    };
    ticket.internalNote = buildTicketNote(ticket, conversationId);
    ticketsDb.upsert(ticket);
    remember(key, 'ticket', id);
    return HttpResponse.json(publicTicket(ticket), { status: 201 });
  }),

  http.get(mock('/support/tickets/:id'), async ({ params }) => {
    await latency(250);
    const ticket = ticketsDb.get(String(params.id));
    if (!ticket) return fail(404, 'No encontramos este ticket.', 'not_found');
    const read = ticket.unread ? ticketsDb.patch(ticket.id, { unread: false }) ?? ticket : ticket;
    return HttpResponse.json(publicTicket(read));
  }),

  http.post(mock('/support/tickets/:id/messages'), async ({ params, request }) => {
    await latency(350);
    const ticket = ticketsDb.get(String(params.id));
    if (!ticket) return fail(404, 'No encontramos este ticket.', 'not_found');
    if (ticket.status === 'closed') return fail(409, 'Este ticket está cerrado. Si necesitas algo más, abre uno nuevo.', 'ticket_closed');
    const body = (await request.json().catch(() => null)) as { body?: unknown; author?: unknown } | null;
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (text.length < 2) return fail(400, 'Escribe tu respuesta.', 'invalid_message');
    if (text.length > 4000) return fail(400, 'La respuesta admite como máximo 4000 caracteres.', 'invalid_message');
    // author: 'team' lo usa el panel de administración para responder.
    const team = body?.author === 'team';
    const message: TicketMessage = { id: newId('msg'), author: team ? 'team' : 'customer', authorName: team ? TEAM : 'Cliente', body: redactSensitive(text).text, createdAt: nowIso() };
    return HttpResponse.json(publicTicket(ticketsDb.upsert(withMessage(ticket, message, team ? 'answered' : 'open'))));
  }),

  // Admin puede cerrar y reabrir el ticket con el contrato compartido de help.
  http.patch(mock('/support/tickets/:id'), async ({ params, request }) => {
    await latency(250);
    const ticket = ticketsDb.get(String(params.id));
    if (!ticket) return fail(404, 'No encontramos este ticket.', 'not_found');
    const body = await request.json().catch(() => null) as { status?: unknown } | null;
    const status = body?.status;
    if (status !== 'open' && status !== 'answered' && status !== 'closed') return fail(400, 'El estado del ticket no es válido.', 'invalid_status');
    return HttpResponse.json(publicTicket(ticketsDb.patch(ticket.id, { status, updatedAt: nowIso() }) ?? ticket));
  }),

  http.post(mock('/support/tickets/:id/close'), async ({ params }) => {
    await latency(250);
    const ticket = ticketsDb.get(String(params.id));
    if (!ticket) return fail(404, 'No encontramos este ticket.', 'not_found');
    return HttpResponse.json(publicTicket(ticketsDb.patch(ticket.id, { status: 'closed', unread: false, updatedAt: nowIso() }) ?? ticket));
  }),

  http.get(mock(SUPPORT_PATHS.slots), async () => {
    await latency(300);
    const config = configDb.get().videocall;
    if (!config.enabled) return fail(503, 'Las videollamadas no están disponibles ahora. Abre un ticket y te ayudamos.', 'videocall_disabled');
    const now = Date.now();
    const days = generateSlotDays(config, { now, taken: takenStarts(refreshBookings(now)), isBusy: busy });
    const body: SlotsResponse = { timezone: config.timezone, durationMin: config.durationMin, priceEur: config.priceEur, vatIncluded: config.vatIncluded, days };
    return HttpResponse.json(body);
  }),

  http.get(mock(SUPPORT_PATHS.bookings), async () => {
    await latency(250);
    return HttpResponse.json(refreshBookings(Date.now()).sort((a, b) => b.start.localeCompare(a.start)));
  }),

  http.post(mock(SUPPORT_PATHS.bookings), async ({ request }) => {
    await latency(400);
    const key = request.headers.get('Idempotency-Key');
    const existing = remembered(key, 'booking');
    if (existing && bookingsDb.get(existing)) return HttpResponse.json(bookingsDb.get(existing), { status: 200 });
    const config = configDb.get().videocall;
    if (!config.enabled) return fail(503, 'Las videollamadas no están disponibles ahora.', 'videocall_disabled');
    const body = (await request.json().catch(() => null)) as { start?: unknown; topic?: unknown; notes?: unknown } | null;
    const now = Date.now();
    const start = typeof body?.start === 'string' ? new Date(body.start) : null;
    if (!start || Number.isNaN(start.getTime()) || !isValidSlot(config, start.toISOString(), now)) return fail(400, 'Ese hueco no está en la agenda. Elige otro.', 'invalid_slot');
    if (!isTopic(body?.topic)) return fail(400, 'Elige el tema de la videollamada.', 'invalid_topic');
    const iso = start.toISOString();
    if (busy(iso) || takenStarts(refreshBookings(now)).has(iso)) return fail(409, 'Alguien acaba de reservar ese hueco. Elige otro, por favor.', 'slot_taken');
    const booking: Booking = {
      id: newId('vc'),
      start: iso,
      end: new Date(start.getTime() + config.durationMin * 60_000).toISOString(),
      durationMin: config.durationMin,
      timezone: config.timezone,
      topic: body.topic,
      notes: typeof body.notes === 'string' ? redactSensitive(body.notes.trim().slice(0, 500)).text : '',
      priceEur: config.priceEur,
      status: 'pending_payment',
      createdAt: new Date(now).toISOString(),
      holdExpiresAt: new Date(now + HOLD_MINUTES * 60_000).toISOString(),
      meetUrl: null,
      paidAt: null,
      receiptNumber: null,
      cancelledAt: null,
      refunded: false,
    };
    bookingsDb.upsert(booking);
    remember(key, 'booking', booking.id);
    return HttpResponse.json(booking, { status: 201 });
  }),

  http.post(mock('/support/bookings/:id/pay'), async ({ params }) => {
    await latency(900);
    refreshBookings(Date.now());
    const booking = bookingsDb.get(String(params.id));
    if (!booking) return fail(404, 'No encontramos esta reserva.', 'not_found');
    if (booking.status === 'confirmed') return HttpResponse.json(booking);
    if (booking.status !== 'pending_payment') return fail(409, 'El tiempo para pagar este hueco ha terminado. Elige otro, por favor.', 'hold_expired');
    const counter = counterDb.update(c => ({ ...c, receipt: c.receipt + 1 }));
    const paid = bookingsDb.patch(booking.id, {
      status: 'confirmed',
      holdExpiresAt: null,
      paidAt: nowIso(),
      meetUrl: `https://meet.google.com/${meetCode(booking.id)}`,
      receiptNumber: `UON-VC-${new Date().getFullYear()}-${String(counter.receipt).padStart(6, '0')}`,
    });
    return HttpResponse.json(paid);
  }),

  http.post(mock('/support/bookings/:id/cancel'), async ({ params }) => {
    await latency(400);
    const booking = bookingsDb.get(String(params.id));
    if (!booking) return fail(404, 'No encontramos esta reserva.', 'not_found');
    const check = cancelCheck(booking, configDb.get().videocall.cancelNoticeHours, Date.now());
    if (!check.ok) return fail(409, check.message, 'cancel_not_allowed');
    return HttpResponse.json(bookingsDb.patch(booking.id, { status: 'cancelled', cancelledAt: nowIso(), refunded: check.refund, holdExpiresAt: null }));
  }),
];
