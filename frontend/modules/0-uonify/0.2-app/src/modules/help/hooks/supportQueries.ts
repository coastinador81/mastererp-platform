import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import {
  cancelBooking, closeTicket, createBooking, createTicket, getBookings, getSlots, getTicket, getTickets,
  idempotencyKey, payBooking, replyTicket,
} from '../api/supportApi';
import type { Booking, BookingInput, Ticket, TicketInput } from '../model/types';

/** Tickets y videollamadas con TanStack Query. */
export const supportKeys = {
  tickets: ['support', 'tickets'] as const,
  ticket: (id: string) => ['support', 'ticket', id] as const,
  slots: ['support', 'slots'] as const,
  bookings: ['support', 'bookings'] as const,
};

export function useTickets() {
  return useQuery({ queryKey: supportKeys.tickets, queryFn: ({ signal }) => getTickets(signal) });
}

export function useTicket(id: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: supportKeys.ticket(id),
    queryFn: async ({ signal }) => {
      const ticket = await getTicket(id, signal);
      // Al abrirlo, la respuesta queda leída: se refresca la lista.
      void client.invalidateQueries({ queryKey: supportKeys.tickets });
      return ticket;
    },
  });
}

function useStoreTicket() {
  const client = useQueryClient();
  return (ticket: Ticket) => {
    client.setQueryData(supportKeys.ticket(ticket.id), ticket);
    void client.invalidateQueries({ queryKey: supportKeys.tickets });
  };
}

/** Crear un ticket. La clave de idempotencia se mantiene entre reintentos del mismo envío. */
export function useCreateTicket() {
  const store = useStoreTicket();
  const key = useRef(idempotencyKey());
  return useMutation({
    mutationFn: (input: TicketInput) => createTicket(input, key.current),
    onSuccess: ticket => {
      key.current = idempotencyKey();
      store(ticket);
    },
  });
}

export function useReplyTicket(id: string) {
  const store = useStoreTicket();
  return useMutation({ mutationFn: (body: string) => replyTicket(id, body), onSuccess: store });
}

export function useCloseTicket(id: string) {
  const store = useStoreTicket();
  return useMutation({ mutationFn: () => closeTicket(id), onSuccess: store });
}

export function useSlots(enabled = true) {
  return useQuery({ queryKey: supportKeys.slots, queryFn: ({ signal }) => getSlots(signal), enabled, staleTime: 0 });
}

export function useBookings() {
  return useQuery({ queryKey: supportKeys.bookings, queryFn: ({ signal }) => getBookings(signal) });
}

function useStoreBooking() {
  const client = useQueryClient();
  return (booking: Booking) => {
    client.setQueryData<Booking[]>(supportKeys.bookings, list => (list ? [booking, ...list.filter(item => item.id !== booking.id)] : [booking]));
    void client.invalidateQueries({ queryKey: supportKeys.slots });
  };
}

export function useCreateBooking() {
  const store = useStoreBooking();
  const key = useRef(idempotencyKey());
  return useMutation({
    mutationFn: (input: BookingInput) => createBooking(input, key.current),
    onSuccess: booking => {
      key.current = idempotencyKey();
      store(booking);
    },
  });
}

export function usePayBooking() {
  const store = useStoreBooking();
  return useMutation({ mutationFn: (id: string) => payBooking(id), onSuccess: store });
}

export function useCancelBooking() {
  const store = useStoreBooking();
  return useMutation({ mutationFn: (id: string) => cancelBooking(id), onSuccess: store });
}
