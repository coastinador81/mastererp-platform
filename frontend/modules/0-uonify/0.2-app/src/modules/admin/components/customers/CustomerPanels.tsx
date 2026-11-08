import type { ReactNode } from 'react';
import type { CustomerDetail } from '../../model/types';
import { formatDateTime } from '../../model/format';
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="adm-panel"><h2>{title}</h2>{children}</section>; }
type Props = { customer: CustomerDetail };
export function AccountPanel({ customer: c }: Props) { return <Panel title="Cuenta"><dl className="adm-facts">{Object.entries({ Propietario: c.ownerName, Correo: c.ownerEmail, Suscripción: c.planName, Google: 'Conectado', Alta: formatDateTime(c.createdAt) }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></Panel>; }
export function MembersPanel({ customer }: Props) { return <Panel title="Usuarios"><ul className="adm-timeline">{customer.members.map(m => <li key={m.email}><strong>{m.name}</strong><p>{m.email} · {m.role}</p></li>)}</ul></Panel>; }
export function AmazonPanel({ customer }: Props) { const a = customer.amazon; return <Panel title="Amazon">{a ? <><p>{a.sellerId} · {a.marketplace}</p><p>Autorización hasta {formatDateTime(a.expiresAt)}</p></> : <p>Sin conexión con Amazon.</p>}</Panel>; }
export function JobsPanel({ customer }: Props) { return <Panel title="Actividad de IA"><p className="adm-inline-note">Lo paga el cliente desde su cuenta de Google; no cuesta a Uonify.</p><ul className="adm-timeline">{customer.jobs.map(job => <li key={job.id}><strong>{job.label}</strong><p>{job.provider} · su cuenta de Google</p><p>{job.error ?? ({ done: 'Completado', failed: 'Fallido', filtered: 'Filtrado', running: 'En curso' }[job.status])}</p></li>)}</ul></Panel>; }
export function AcceptancesPanel({ customer }: Props) { return <Panel title="Consentimientos"><ul className="adm-timeline">{customer.acceptances.map((item, i) => <li key={i}><strong>{item.document} · {item.version}</strong><p>{formatDateTime(item.acceptedAt)} · {item.where}</p></li>)}</ul></Panel>; }
