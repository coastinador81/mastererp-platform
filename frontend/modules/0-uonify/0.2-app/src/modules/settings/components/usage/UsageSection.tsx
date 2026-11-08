import { useState } from 'react';
import { useInterval } from '@/shared/hooks';
import { IconButton } from '@/shared/ui';
import { useChatGptUsage, useConnections, useTokenBalance, useTokenMovements } from '../../hooks/queries';
import { formatRelative } from '../../model/format';
import { ChatGptLimits } from './ChatGptLimits';
import { TokenBalanceCard } from './TokenBalanceCard';

function updatedLabel(updatedAt: number, now: number): string {
  if (!updatedAt) return '';
  return now - updatedAt < 60_000 ? 'hace menos de un minuto' : formatRelative(updatedAt, now);
}

/**
 * Uso, al estilo de Claude: arriba los límites en vivo del plan de ChatGPT (se
 * refrescan cada minuto) y debajo el saldo de tokens de Uonify con sus movimientos.
 * Los dos contadores se ven distintos: porcentaje con reinicio frente a saldo.
 */
export function UsageSection() {
  const connections = useConnections();
  const connected = connections.data?.chatgpt.status === 'connected';
  const chatgpt = useChatGptUsage(connected);
  const balance = useTokenBalance();
  const movements = useTokenMovements();
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 30_000);

  const updatedAt = Math.max(chatgpt.dataUpdatedAt || 0, balance.dataUpdatedAt || 0);
  const refreshing = chatgpt.isFetching || balance.isFetching || movements.isFetching;
  const refresh = () => {
    setNow(Date.now());
    void connections.refetch();
    if (connected) void chatgpt.refetch();
    void balance.refetch();
    void movements.refetch();
  };

  return (
    <div className="uset-stack">
      <div className="uset-updated" aria-live="polite">
        <span>{updatedAt ? `Última actualización: ${updatedLabel(updatedAt, Math.max(now, updatedAt))}` : 'Consultando tu uso…'}</span>
        <IconButton icon="refresh-cw" size="sm" label="Actualizar el uso" onClick={refresh} loading={refreshing} tooltipPos="below" tooltipAlign="end" />
      </div>
      <ChatGptLimits
        connection={connections.data?.chatgpt}
        bars={chatgpt.usage.bars}
        plan={chatgpt.usage.plan}
        loading={connected && chatgpt.isPending}
        error={chatgpt.isError ? chatgpt.error : null}
        onRetry={() => void chatgpt.refetch()}
      />
      <TokenBalanceCard
        balance={balance.balance}
        balanceLoading={balance.isPending}
        balanceError={balance.isError ? balance.error : null}
        movements={movements.movements}
        movementsLoading={movements.isPending}
        movementsError={movements.isError ? movements.error : null}
        onRetry={() => void balance.refetch()}
      />
    </div>
  );
}
