import { useId } from 'react';
import { errorMessage } from '@/shared/api/client';
import { Alert, Badge, Empty, IconButton, LinkButton, Section, SectionHead, Spinner, type BadgeTone } from '@/shared/ui';
import { documentTitle, downloadDocument } from '../../flows/documents';
import { useInvoices } from '../../hooks/useBilling';
import { euros, shortDate } from '../../model/money';
import type { BillingDocument, DocumentStatus } from '../../model/types';

const STATUS: Record<DocumentStatus, { label: string; tone: BadgeTone }> = {
  paid: { label: 'Pagada', tone: 'green' },
  rectified: { label: 'Rectificada', tone: 'amber' },
  issued: { label: 'Emitida', tone: 'neutral' },
  refunded: { label: 'Devuelta', tone: 'neutral' },
};

/** Facturas, notas de crédito y facturas rectificativas, con su PDF. */
export function InvoicesPanel() {
  const titleId = useId();
  const invoices = useInvoices();
  const list = invoices.data ?? [];
  return (
    <Section aria-labelledby={titleId} className="bil-block">
      <SectionHead titleId={titleId} icon="bil-receipt" title="Facturas" subtitle="Tus facturas y, si desistes de un plan, la nota de crédito y la factura rectificativa." />
      {invoices.isPending ? (
        <Spinner label="Cargando las facturas…" />
      ) : invoices.isError ? (
        <Alert tone="red" role="alert">
          {errorMessage(invoices.error, 'No se han podido cargar las facturas.')}{' '}
          <LinkButton onClick={() => void invoices.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : list.length === 0 ? (
        <Empty icon="bil-receipt" title="Aún no hay facturas" description="Cuando pagues un plan o una recarga, la factura aparecerá aquí." />
      ) : (
        <ul className="bil-rows" aria-labelledby={titleId}>
          {list.map(doc => (
            <InvoiceRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InvoiceRow({ doc }: { doc: BillingDocument }) {
  const status = STATUS[doc.status];
  const title = documentTitle(doc);
  return (
    <li className="bil-row bil-invoice">
      <span className="bil-row-main">
        <strong>
          <span className="pim-mono">{doc.number}</span> · {doc.concept}
        </strong>
        <small>
          <time dateTime={doc.issuedAt}>{shortDate(doc.issuedAt)}</time>
          {doc.kind !== 'invoice' ? ` · ${doc.kind === 'credit_note' ? 'Nota de crédito' : 'Factura rectificativa'}` : ''}
          {doc.rectifies ? ` de ${doc.rectifies}` : ''}
        </small>
      </span>
      <span className="bil-row-amount">
        <strong className="pim-mono">{euros(doc.total)}</strong>
        <Badge tone={status.tone}>{status.label}</Badge>
      </span>
      <IconButton icon="download" label={`Descargar ${title} en PDF`} tooltipPos="above" tooltipAlign="end" onClick={() => void downloadDocument(doc)} />
    </li>
  );
}
