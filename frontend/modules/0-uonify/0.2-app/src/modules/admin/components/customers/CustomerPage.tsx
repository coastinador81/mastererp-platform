import { Link, useParams } from 'react-router';
import { Alert, Icon } from '@/shared/ui';
import { useCustomer } from '../../hooks/useCustomers';
import type { CustomerDetail } from '../../model/types';
import { PageHeader, QueryState, StatusBadge } from '../common/PageParts';
import { CUSTOMER_STATUS } from '../../model/labels';
import { CustomerLedger } from './CustomerLedger';
import { CustomerNotes } from './CustomerNotes';
import { AccountPanel, AcceptancesPanel, AmazonPanel, JobsPanel, MembersPanel } from './CustomerPanels';

/**
 * Ficha de una cuenta (H2b, SOLO LECTURA): suscripción y movimientos, conexiones,
 * actividad de IA, consentimientos y notas. Las acciones con efecto en el cliente
 * (suspender, cortar la IA, ajuste) son H2d y esperan la decisión del dueño.
 */
export function CustomerPage() {
  const { customerId } = useParams();
  const customer = useCustomer(customerId);
  return (
    <div className="adm-page">
      <Link className="adm-back" to="/admin/clientes">
        <Icon name="arrow-left" size={14} />
        Clientes
      </Link>
      <QueryState isPending={customer.isPending} error={customer.error} onRetry={() => void customer.refetch()}>
        {customer.data ? <CustomerView customer={customer.data} /> : null}
      </QueryState>
    </div>
  );
}

function CustomerView({ customer }: { customer: CustomerDetail }) {
  return (
    <>
      <PageHeader
        title={customer.company || customer.ownerName || customer.ownerEmail}
        description={
          <>
            {customer.ownerName} · {customer.ownerEmail} · Suscripción {customer.planName} <StatusBadge status={CUSTOMER_STATUS[customer.status]} />
          </>
        }
      />
      <StatusAlerts customer={customer} />
      <div className="adm-grid-2">
        <AccountPanel customer={customer} />
        <CustomerLedger customer={customer} canApprove={false} memberName="" onApprove={async () => {}} />
        <MembersPanel customer={customer} />
        <AmazonPanel customer={customer} />
        <JobsPanel customer={customer} />
        <AcceptancesPanel customer={customer} />
        <CustomerNotes customer={customer} canWrite={false} onAdd={async () => {}} />
      </div>
    </>
  );
}

function StatusAlerts({ customer }: { customer: CustomerDetail }) {
  return (
    <>
      {customer.status === 'suspended' ? (
        <Alert tone="red" role="status" title="Cuenta suspendida">
          {customer.suspendReason ?? 'Sin motivo registrado.'} El cliente no puede usar Uonify hasta que se reactive.
        </Alert>
      ) : null}
      {customer.status === 'pending_deletion' ? (
        <Alert tone="amber" role="status" title="Pendiente de borrado">
          {customer.suspendReason ?? 'El cliente pidió borrar su cuenta.'} Las facturas se conservan por obligación fiscal.
        </Alert>
      ) : null}
      {customer.aiBlocked ? (
        <Alert tone="amber" role="status" title="IA cortada">
          Uony no responde en esta cuenta y no se generan imágenes, vídeo ni 3D. El resto de Uonify sigue funcionando.
        </Alert>
      ) : null}
    </>
  );
}
