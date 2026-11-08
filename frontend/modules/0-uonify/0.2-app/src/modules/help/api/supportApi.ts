import { api } from '@/shared/api/client';
import { uid } from '@/shared/lib';
import type { Booking, BookingInput, SlotsResponse, Ticket, TicketInput, TicketSummary } from '../model/types';
import { SUPPORT_PATHS } from './paths';

/** Llamadas de soporte: tickets y videollamadas (contrato en paths.ts). */

/** Clave para que un reintento no cree dos veces lo mismo. */
export function idempotencyKey(): string {
  return uid('idem');
}

export function getTickets(signal?: AbortSignal): Promise<TicketSummary[]> {
  return api.get<TicketSummary[]>(SUPPORT_PATHS.tickets, { signal });
}

export function getTicket(id: string, signal?: AbortSignal): Promise<Ticket> {
  return api.get<Ticket>(SUPPORT_PATHS.ticket(id), { signal });
}

export function createTicket(input: TicketInput, key = idempotencyKey()): Promise<Ticket> {
  return api.post<Ticket>(SUPPORT_PATHS.tickets, input, { headers: { 'Idempotency-Key': key } });
}

export function replyTicket(id: string, body: string): Promise<Ticket> {
  return api.post<Ticket>(SUPPORT_PATHS.ticketMessages(id), { body });
}

export function closeTicket(id: string): Promise<Ticket> {
  return api.post<Ticket>(SUPPORT_PATHS.ticketClose(id));
}

export function getSlots(signal?: AbortSignal): Promise<SlotsResponse> {
  return api.get<SlotsResponse>(SUPPORT_PATHS.slots, { signal });
}

export function getBookings(signal?: AbortSignal): Promise<Booking[]> {
  return api.get<Booking[]>(SUPPORT_PATHS.bookings, { signal });
}

export function createBooking(input: BookingInput, key = idempotencyKey()): Promise<Booking> {
  return api.post<Booking>(SUPPORT_PATHS.bookings, input, { headers: { 'Idempotency-Key': key } });
}

export function payBooking(id: string): Promise<Booking> {
  return api.post<Booking>(SUPPORT_PATHS.bookingPay(id));
}

export function cancelBooking(id: string): Promise<Booking> {
  return api.post<Booking>(SUPPORT_PATHS.bookingCancel(id));
}
