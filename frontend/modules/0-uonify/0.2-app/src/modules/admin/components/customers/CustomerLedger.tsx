import { useState } from 'react';
import { Button, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import type { CustomerDetail } from '../../model/types';
import { formatDateTime, formatMoney } from '../../model/format';

/** Suscripción de la cuenta y sus movimientos en euros (sin tokens). */
export function CustomerLedger({ customer, canApprove, memberName, onApprove }: { customer: CustomerDetail; canApprove: boolean; memberName: string; onApprove: (id: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const trial = customer.planName.startsWith('Prueba');
  return (
    <section className="adm-panel">
      <h2>Suscripción y movimientos</h2>
      <strong>{trial ? 'En prueba (14 días)' : `Suscripción ${customer.planName.toLowerCase()}`}</strong>
      {customer.ledger.length === 0 ? (
        <p className="adm-inline-note" style={{ marginTop: 8 }}>Sin cobros todavía.</p>
      ) : (
        <ul className="adm-timeline">
          {customer.ledger.map(entry => (
            <li key={entry.id}>
              <strong>{formatMoney(entry.tokens, true)}</strong>
              <p>{entry.description}</p>
              {entry.reason ? <p>{entry.reason}</p> : null}
              <small>{formatDateTime(entry.at)} · {entry.status === 'posted' ? 'Contabilizado' : 'Pendiente de aprobación'}</small>
              {entry.status === 'pending' && canApprove && entry.author !== memberName ? (
                <Button disabled={busy} onClick={async () => { setBusy(true); try { await onApprove(entry.id); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>
                  Aprobar ajuste
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
