import { Link } from 'react-router';
import { buttonClass } from '@/shared/ui';
import { formatDate, formatEuros, formatTokens } from '../../model/format';
import { settingsPath } from '../../model/sections';
import type { TokenBalance, TokenMovement } from '../../model/usage';
import { LoadError, Loading, SettingsCard } from '../common';

export interface TokenBalanceCardProps {
  balance: TokenBalance | null;
  balanceLoading: boolean;
  balanceError: unknown;
  movements: TokenMovement[];
  movementsLoading: boolean;
  movementsError: unknown;
  onRetry: () => void;
}

/** Tokens de Uonify: saldo con su valor en euros y los últimos movimientos. */
export function TokenBalanceCard({ balance, balanceLoading, balanceError, movements, movementsLoading, movementsError, onRetry }: TokenBalanceCardProps) {
  return (
    <SettingsCard
      title="Tokens de Uonify"
      icon="uset-card"
      description="Se gastan en el vídeo y en las acciones de Uony que no usan tu plan de ChatGPT. Recargas desde 20 €."
      actions={<Link to={settingsPath('plan')} className={buttonClass('outline', 'sm')}>Recargar tokens</Link>}
    >
      {balanceLoading ? <Loading label="Consultando tu saldo…" /> : null}
      {!balanceLoading && balanceError ? <LoadError error={balanceError} onRetry={onRetry} title="No se ha podido cargar el saldo" /> : null}
      {balance ? (
        <p className="uset-balance" aria-live="polite">
          <span className="uset-balance-label">Saldo actual</span>
          <span className="uset-balance-value">
            <strong>{formatTokens(balance.tokens)}</strong>
            <span className="uset-balance-eur"> · {formatEuros(balance.euros)}</span>
          </span>
        </p>
      ) : null}

      <div className="uset-movements">
        <h4 className="uset-subtitle">Últimos movimientos</h4>
        {movementsLoading ? <Loading label="Cargando movimientos…" /> : null}
        {!movementsLoading && movementsError ? <p className="pim-small pim-muted">No se han podido cargar los movimientos.</p> : null}
        {!movementsLoading && !movementsError && !movements.length ? <p className="pim-small pim-muted">Aún no hay movimientos.</p> : null}
        {movements.length ? (
          <table className="uset-table">
            <caption className="pim-sr-only">Últimos movimientos de tokens de Uonify</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Concepto</th>
                <th scope="col" className="is-num">Tokens</th>
                <th scope="col" className="is-num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(movement => (
                <tr key={movement.id}>
                  <td data-label="Fecha">{formatDate(movement.date)}</td>
                  <td data-label="Concepto">{movement.concept}</td>
                  <td data-label="Tokens" className={`is-num pim-mono${movement.tokens > 0 ? ' is-positive' : ''}`}>
                    {movement.tokens > 0 ? '+' : ''}{formatTokens(movement.tokens)}
                  </td>
                  <td data-label="Importe" className="is-num pim-mono">{formatEuros(movement.euros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </SettingsCard>
  );
}
