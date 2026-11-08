import { useState } from 'react';
import { Segmented } from '@/shared/ui';
import { useMetrics } from '../../hooks/useOperations';
import { formatDelta, formatEuro, formatInteger, formatPercent } from '../../model/format';
import type { AdminMetrics, MetricsRange } from '../../model/types';
import { Meter, PageHeader, QueryState, StatTile } from '../common/PageParts';

const RANGES: { value: MetricsRange; label: string }[] = [
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: '12m', label: '12 meses' },
];

/** Resumen: el cuadro básico del negocio por periodo. */
export function OverviewPage() {
  const [range, setRange] = useState<MetricsRange>('30d');
  const metrics = useMetrics(range);
  return (
    <div className="adm-page">
      <PageHeader
        title="Resumen"
        description="Altas, cuentas y suscripciones. El cliente paga su consumo de IA desde su cuenta de Google; Uonify cobra la suscripción. El MRR y las bajas salen de Stripe."
        actions={<Segmented aria-label="Periodo" value={range} onChange={setRange} options={RANGES} />}
      />
      <QueryState isPending={metrics.isPending} error={metrics.error} onRetry={() => void metrics.refetch()}>
        {metrics.data ? <Dashboard metrics={metrics.data} /> : null}
      </QueryState>
    </div>
  );
}

function Dashboard({ metrics }: { metrics: AdminMetrics }) {
  const { kpis, previous } = metrics;
  const totalAccounts = metrics.byPlan.reduce((sum, state) => sum + state.accounts, 0);
  return (
    <>
      <section aria-labelledby="adm-kpi-accounts">
        <h2 id="adm-kpi-accounts" className="pim-sr-only">
          Cuentas
        </h2>
        <div className="adm-stats">
          <StatTile label="Altas" value={formatInteger(kpis.signups)} delta={formatDelta(kpis.signups, previous.signups)} />
          <StatTile label="Cuentas activas" value={formatInteger(kpis.activeAccounts)} delta={formatDelta(kpis.activeAccounts, previous.activeAccounts)} />
          <StatTile label="Suscritas" value={formatInteger(kpis.paidAccounts)} delta={formatDelta(kpis.paidAccounts, previous.paidAccounts)} hint="Mensual o anual" />
          <StatTile label="En prueba" value={formatInteger(kpis.trialAccounts)} hint="Dentro de los 14 días" />
          <StatTile label="Conversión prueba → pago" value={formatPercent(kpis.conversionRate)} />
          <StatTile label="MRR" value={formatEuro(kpis.mrrEur, true)} delta={formatDelta(kpis.mrrEur, previous.mrrEur)} hint="Suscripciones en su equivalente mensual" />
        </div>
      </section>
      <div className="adm-grid-2">
        <section className="adm-panel" aria-labelledby="adm-kpi-subs">
          <div className="adm-panel-head">
            <div>
              <h2 id="adm-kpi-subs">Suscripción y operación</h2>
              <p>El cliente paga su consumo de IA desde su cuenta de Google; no cuesta a Uonify. Aquí figura la suscripción y lo que cuesta operar.</p>
            </div>
          </div>
          <div className="adm-stats">
            <StatTile label="MRR" value={formatEuro(kpis.mrrEur, true)} />
            <StatTile label="Cancelaciones" value={formatPercent(kpis.churnRate)} hint="Bajas sobre suscritas" />
            <StatTile label="Coste de operación" value={formatEuro(kpis.operationCostEur, true)} hint="Soporte Uony, voz e infraestructura" />
            <StatTile label="Tickets abiertos" value={formatInteger(kpis.openTickets)} />
          </div>
        </section>
        <section className="adm-panel" aria-labelledby="adm-kpi-states">
          <div className="adm-panel-head">
            <div>
              <h2 id="adm-kpi-states">Cuentas por estado</h2>
              <p>{formatInteger(totalAccounts)} cuentas en total.</p>
            </div>
          </div>
          <ul className="adm-bars">
            {metrics.byPlan.map(state => (
              <li key={state.planId}>
                <span>{state.name}</span>
                <Meter value={state.accounts} max={totalAccounts} label={`${state.name}: ${state.accounts} de ${totalAccounts} cuentas`} />
                <strong>{formatInteger(state.accounts)}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
