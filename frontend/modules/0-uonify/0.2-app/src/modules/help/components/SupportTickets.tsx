import { useState } from 'react';
import { Button, Field, Input, Textarea } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useTickets, useTicket, useCreateTicket, useReplyTicket } from '../hooks/supportQueries';
import { navigate, replaceRoute, type TicketPrefill } from '../hooks/panelStore';
export function TicketList() {
  const query = useTickets();
  return <><Button variant="primary" onClick={() => navigate({ view: 'new-ticket' })}>Abrir un ticket</Button>{query.isPending ? <p role="status">Cargando tickets…</p> : null}{query.error ? <p role="alert">{errorMessage(query.error)}</p> : null}{query.data?.length === 0 ? <p>No tienes tickets abiertos.</p> : null}<ul>{query.data?.map(t => <li key={t.id}><button type="button" onClick={() => navigate({ view: 'ticket', id: t.id })}>{t.number} · {t.subject}</button><p>{{ open: 'Abierto', answered: 'Respondido', closed: 'Cerrado' }[t.status]}</p></li>)}</ul></>;
}
export function TicketForm({ prefill }: { prefill?: TicketPrefill }) {
  const [subject, setSubject] = useState(prefill?.subject ?? ''); const [message, setMessage] = useState(prefill?.message ?? ''); const create = useCreateTicket();
  return <form className="hlp-panel-body" onSubmit={e => { e.preventDefault(); create.mutate({ ...prefill, subject, message, category: prefill?.category ?? 'other', source: prefill?.source ?? 'form' }, { onSuccess: t => replaceRoute({ view: 'ticket', id: t.id, created: true }) }); }}>
    <Field label="Asunto"><Input required value={subject} onChange={e => setSubject(e.target.value)} /></Field><Field label="Cuéntanos qué ha pasado"><Textarea required rows={6} value={message} onChange={e => setMessage(e.target.value)} /></Field>{create.error ? <p role="alert">{errorMessage(create.error)}</p> : null}<Button type="submit" variant="primary" loading={create.isPending}>Enviar ticket</Button>
  </form>;
}
export function TicketDetail({ id }: { id: string }) {
  const query = useTicket(id); const reply = useReplyTicket(id); const [body, setBody] = useState('');
  return <>{query.data ? <><h2>{query.data.number} · {query.data.subject}</h2><div className="hlp-transcript">{query.data.messages.map(m => <article key={m.id}><strong>{m.authorName}</strong><p>{m.body}</p></article>)}</div>{query.data.status !== 'closed' ? <form className="hlp-panel-body" onSubmit={e => { e.preventDefault(); reply.mutate(body, { onSuccess: () => setBody('') }); }}><Field label="Tu respuesta"><Textarea required value={body} onChange={e => setBody(e.target.value)} /></Field><Button variant="primary" type="submit" loading={reply.isPending}>Enviar respuesta</Button></form> : <p>Ticket cerrado.</p>}</> : <p>Cargando ticket…</p>}{query.error || reply.error ? <p role="alert">{errorMessage(query.error || reply.error)}</p> : null}</>;
}
