import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Field, Textarea, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useTickets, useTicket, useTicketActions } from '../../hooks/useExternal';
import { useAdminMember } from '../../hooks/useAdminSession';
import { can } from '../../model/permissions';
import { PageHeader, QueryState } from '../common/PageParts';
export function SupportPage() {
  const query = useTickets(); const { ticketId } = useParams();
  return <div className="adm-page"><PageHeader title="Soporte" description="Tickets y conversaciones derivadas por Uony." /><div className="adm-grid-2"><QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()} empty={query.data?.length === 0} emptyTitle="No hay tickets"><ul className="adm-timeline">{query.data?.map(ticket => <li key={ticket.id}><Link to={`/admin/soporte/${ticket.id}`}>{ticket.number} · {ticket.subject}</Link><p>{ticket.customerEmail}</p><small>{{ open: 'Abierto', answered: 'Respondido', closed: 'Cerrado' }[ticket.status]}</small></li>)}</ul></QueryState>{ticketId ? <Ticket key={ticketId} id={ticketId} /> : <p>Elige un ticket para leer la conversación.</p>}</div></div>;
}
function Ticket({ id }: { id: string }) {
  const query = useTicket(id); const member = useAdminMember(); const actions = useTicketActions(id, query.data?.subject ?? id); const [body, setBody] = useState('');
  return <QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>{query.data ? <section className="adm-panel"><h2>{query.data.subject}</h2><ul className="adm-timeline">{query.data.transcript.map((turn, i) => <li key={`t${i}`}><strong>{turn.role === 'uony' ? 'Uony' : 'Cliente'}</strong><p>{turn.text}</p></li>)}{query.data.messages.map(message => <li key={message.id}><strong>{message.authorName}</strong><p>{message.body}</p></li>)}</ul>{can(member.role, 'support.reply') ? <form className="adm-form" onSubmit={async e => { e.preventDefault(); try { await actions.reply.mutateAsync({ body, authorName: member.name }); setBody(''); } catch (reason) { toast.error(errorMessage(reason)); } }}><Field label="Respuesta al cliente"><Textarea value={body} onChange={e => setBody(e.target.value)} /></Field><Button type="submit" variant="primary" loading={actions.reply.isPending} disabled={!body.trim()}>Enviar respuesta</Button><Button disabled={actions.setStatus.isPending} onClick={() => actions.setStatus.mutate(query.data!.status === 'closed' ? 'open' : 'closed', { onError: e => toast.error(errorMessage(e)) })}>{query.data.status === 'closed' ? 'Reabrir ticket' : 'Cerrar ticket'}</Button></form> : null}</section> : null}</QueryState>;
}
