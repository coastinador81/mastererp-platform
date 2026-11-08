import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useDebouncedValue } from '@/shared/hooks';
import { Badge, Field, Input, Select } from '@/shared/ui';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { formatDate } from '../../model/format';
import { CUSTOMER_STATUS } from '../../model/labels';
import type { CustomerSummary } from '../../model/types';
import { PageHeader, QueryState, StatusBadge, TableWrap } from '../common/PageParts';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Activas' },
  { value: 'suspended', label: 'Suspendidas' },
  { value: 'pending_deletion', label: 'Pendientes de borrado' },
  { value: 'ai_blocked', label: 'Con la IA cortada' },
];

/** Clientes: búsqueda por correo, empresa, ID de cuenta, ID de Stripe o Seller ID. */
export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const status = params.get('estado') ?? '';
  const debounced = useDebouncedValue(query.trim(), 250);
  const search = useCustomerSearch(debounced, status);

  const update = (next: { q?: string; estado?: string }) => {
    const merged = new URLSearchParams(params);
    Object.entries(next).forEach(([key, value]) => (value ? merged.set(key, value) : merged.delete(key)));
    setParams(merged, { replace: true });
  };

  return (
    <div className="adm-page">
      <PageHeader title="Clientes" description="Busca una cuenta para ver su ficha, su suscripción y su actividad. Nadie del equipo ve credenciales ni datos de tarjeta." />
      <div className="adm-filters" role="search">
        <Field className="adm-search" label="Buscar">
          <Input
            type="search"
            placeholder="Correo, empresa, acc_…, cus_… o Seller ID"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              update({ q: event.target.value.trim() });
            }}
          />
        </Field>
        <Field label="Estado">
          <Select value={status} onChange={event => update({ estado: event.target.value })} placeholder="Todas" options={STATUS_OPTIONS} />
        </Field>
      </div>
      <QueryState
        isPending={search.isPending}
        error={search.error}
        onRetry={() => void search.refetch()}
        empty={search.data?.length === 0}
        emptyIcon="adm-users"
        emptyTitle="No hay cuentas con esa búsqueda"
        emptyDescription="Prueba con el correo completo, el ID de la cuenta (acc_…) o el de Stripe (cus_…)."
      >
        {search.data ? <CustomersTable customers={search.data} /> : null}
      </QueryState>
    </div>
  );
}

function CustomersTable({ customers }: { customers: CustomerSummary[] }) {
  return (
    <>
      <p className="adm-count" role="status">
        {customers.length === 1 ? '1 cuenta' : `${customers.length} cuentas`}
      </p>
      <TableWrap label="Cuentas encontradas">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Cuenta</th>
              <th scope="col">Suscripción</th>
              <th scope="col">Estado</th>
              <th scope="col">Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {customers.map(customer => (
              <tr key={customer.id}>
                <td>
                  <Link className="adm-row-link" to={`/admin/clientes/${customer.id}`}>
                    {customer.company || customer.ownerName || customer.ownerEmail}
                  </Link>
                  <span className="adm-cell-sub">
                    {customer.ownerEmail} · <span className="adm-mono">{customer.id}</span>
                  </span>
                </td>
                <td>{customer.planName}</td>
                <td>
                  <span className="adm-badges">
                    <StatusBadge status={CUSTOMER_STATUS[customer.status]} />
                    {customer.aiBlocked ? <Badge tone="red">IA cortada</Badge> : null}
                  </span>
                </td>
                <td className="is-nowrap">{formatDate(customer.lastActiveAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
