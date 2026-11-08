import { useState } from 'react';
import { Button, Field, Input } from '@/shared/ui';
import { useInvoices, useWithdrawals, useCreditNotes, useRetryWithdrawal } from '../../hooks/useOperations';
import { useAdminMember } from '../../hooks/useAdminSession';
import { can } from '../../model/permissions';
import { formatEuro } from '../../model/format';
import { PageHeader, QueryState } from '../common/PageParts';
import { ReasonDialog } from '../common/ReasonDialog';
export function FinancePage() {
  const [q, setQ] = useState(''); const invoices = useInvoices(q, ''); const withdrawals = useWithdrawals(); const notes = useCreditNotes(); const retry = useRetryWithdrawal(); const member = useAdminMember(); const [retryId, setRetryId] = useState<string | null>(null);
  return <div className="adm-page"><PageHeader title="Facturación" description="Facturas de suscripción, desistimientos de 14 días y notas de crédito. El consumo de IA lo paga el cliente en su cuenta de Google y no se factura aquí." /><Field label="Buscar facturas"><Input value={q} onChange={e => setQ(e.target.value)} /></Field>
    <section className="adm-panel"><h2>Facturas</h2><QueryState isPending={invoices.isPending} error={invoices.error} onRetry={() => void invoices.refetch()}><ul className="adm-timeline">{invoices.data?.map(i => <li key={i.id}><strong>{i.number} · {formatEuro(i.totalEur)}</strong><p>{i.customerName} · {i.concept}</p></li>)}</ul></QueryState></section>
    <section className="adm-panel"><h2>Desistimientos</h2><QueryState isPending={withdrawals.isPending} error={withdrawals.error} onRetry={() => void withdrawals.refetch()}><ul className="adm-timeline">{withdrawals.data?.map(w => <li key={w.id}><strong>{w.customerName} · {formatEuro(w.refundEur)}</strong><p>{w.invoiceNumber} · {{ pending: 'En curso', refunded: 'Devuelto', failed: 'Fallido' }[w.status]}</p>{w.error ? <p>{w.error}</p> : null}{w.status === 'failed' && can(member.role, 'finance.retry') ? <Button onClick={() => setRetryId(w.id)}>Reintentar devolución</Button> : null}</li>)}</ul></QueryState></section>
    <section className="adm-panel"><h2>Notas de crédito</h2><QueryState isPending={notes.isPending} error={notes.error} onRetry={() => void notes.refetch()}><ul className="adm-timeline">{notes.data?.map(n => <li key={n.id}><strong>{n.number} · {formatEuro(n.amountEur)}</strong><p>{n.customerName} · Factura rectificativa {n.correctiveInvoiceNumber}</p><p>{n.reason}</p></li>)}</ul></QueryState></section>
    <ReasonDialog open={!!retryId} title="Reintentar devolución" confirmLabel="Reintentar" onClose={() => setRetryId(null)} onConfirm={reason => retry.mutateAsync({ id: retryId!, reason })} />
  </div>;
}
