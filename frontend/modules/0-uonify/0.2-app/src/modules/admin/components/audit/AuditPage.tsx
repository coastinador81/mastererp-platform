import { useState } from 'react';
import { Field, Input } from '@/shared/ui';
import { useAudit } from '../../hooks/useOperations';
import { formatDateTime } from '../../model/format';
import { PageHeader, QueryState } from '../common/PageParts';
export function AuditPage() {
  const [q, setQ] = useState(''); const query = useAudit({ q, action: '', actor: '' });
  return <div className="adm-page"><PageHeader title="Auditoría" description="Registro de las acciones del equipo y sus motivos." /><Field label="Buscar en el registro"><Input value={q} onChange={e => setQ(e.target.value)} /></Field><QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()} empty={query.data?.length === 0} emptyTitle="Sin acciones que coincidan"><ul className="adm-timeline">{query.data?.map(entry => <li key={entry.id}><strong>{entry.action} · {entry.target.label}</strong><p>{entry.actor.name} · {formatDateTime(entry.at)}</p><p>{entry.reason}</p><p>{entry.detail}</p></li>)}</ul></QueryState></div>;
}
