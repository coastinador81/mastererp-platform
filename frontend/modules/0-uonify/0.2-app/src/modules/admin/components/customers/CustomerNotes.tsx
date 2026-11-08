import { useState } from 'react';
import { Button, Field, Textarea, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import type { CustomerDetail } from '../../model/types';
import { formatDateTime } from '../../model/format';
export function CustomerNotes({ customer, canWrite, onAdd }: { customer: CustomerDetail; canWrite: boolean; onAdd: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  return <section className="adm-panel"><h2>Notas internas</h2>{canWrite ? <form className="adm-form" onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; setBusy(true); try { await onAdd(text.trim()); setText(''); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }}><Field label="Nueva nota"><Textarea value={text} maxLength={2000} onChange={e => setText(e.target.value)} /></Field><Button type="submit" loading={busy} disabled={!text.trim()}>Añadir nota</Button></form> : null}<ul className="adm-timeline">{customer.notes.map(note => <li key={note.id}><strong>{note.author} · {formatDateTime(note.at)}</strong><p>{note.text}</p></li>)}</ul></section>;
}
