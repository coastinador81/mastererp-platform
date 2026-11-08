import { useState } from 'react';
import { Button, Field, Select, Textarea } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useSlots, useCreateBooking, usePayBooking, useBookings } from '../hooks/supportQueries';
import type { Booking } from '../model/types';
export function BookingView() {
  const slots = useSlots(); const bookings = useBookings(); const create = useCreateBooking(); const pay = usePayBooking();
  const [start, setStart] = useState(''); const [notes, setNotes] = useState(''); const [booking, setBooking] = useState<Booking | null>(null);
  const error = slots.error || create.error || pay.error;
  const available = slots.data?.days.flatMap(d => d.slots.filter(s => s.available)) ?? [];
  const label = (value: string) => new Date(value).toLocaleString('es-ES', { timeZone: slots.data?.timezone ?? 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' });
  return <><h2>Videollamada con el equipo </h2>{slots.data ? <p>{slots.data.durationMin} minutos por Google Meet · {slots.data.priceEur.toLocaleString('es-ES')} € {slots.data.vatIncluded ? '(IVA incluido)' : '(impuestos no incluidos)'}. Horas de {slots.data.timezone}.</p> : <p>Cargando horarios…</p>}
    {booking?.status === 'confirmed' ? <p role="status">Reserva confirmada: {label(booking.start)}. {booking.meetUrl ? <a href={booking.meetUrl} target="_blank" rel="noreferrer">Abrir Google Meet</a> : null}</p> : booking ? <><p>Horario reservado: {label(booking.start)}. Confirma el pago de {booking.priceEur} € para completar la reserva.</p><Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate(booking.id, { onSuccess: setBooking })}>Pagar y confirmar reserva</Button></> : <form className="hlp-panel-body" onSubmit={e => { e.preventDefault(); create.mutate({ start, topic: 'other', notes }, { onSuccess: setBooking }); }}><Field label="Fecha y hora"><Select required value={start} onChange={e => setStart(e.target.value)}><option value="">Elige un horario</option>{available.map(s => <option key={s.start} value={s.start}>{label(s.start)}</option>)}</Select></Field><Field label="Qué te gustaría revisar"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field><Button variant="primary" type="submit" disabled={!start} loading={create.isPending}>Continuar al pago</Button></form>}
    {error ? <p role="alert">{errorMessage(error)}</p> : null}<h3>Mis reservas</h3><ul>{bookings.data?.map(b => <li key={b.id}>{label(b.start)} · {{ confirmed: 'Confirmada', pending_payment: 'Pendiente de pago', cancelled: 'Cancelada', completed: 'Completada', expired: 'Caducada' }[b.status]}{b.status === 'confirmed' && b.meetUrl ? <> · <a href={b.meetUrl}>Google Meet</a></> : null}</li>)}</ul>
  </>;
}
