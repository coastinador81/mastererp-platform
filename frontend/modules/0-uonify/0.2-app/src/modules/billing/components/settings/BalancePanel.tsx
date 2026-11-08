import { useId, useState } from 'react';
import clsx from 'clsx';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Empty, LinkButton, Section, SectionHead, Spinner } from '@/shared/ui';
import { openRecharge } from '../../flows/checkout';
import { useBalance, useBillingConfig, useMovements } from '../../hooks/useBilling';
import { euros, eurosShort, longDate, shortDate, signedNumber, tokens, tokensLabel } from '../../model/money';
import type { Movement } from '../../model/types';

const PAGE = 5;
const ALL = 50;

/**
 * Tokens de Uonify: saldo con su valor en euros, subcuentas (incluidos en el plan
 * y recargados), «Recargar» desde 20 € y los últimos movimientos.
 */
export function BalancePanel({ primary }: { primary: boolean }) {
  const titleId = useId();
  const balance = useBalance();
  const config = useBillingConfig();
  const data = balance.data;
  return (
    <Section aria-labelledby={titleId} className="bil-block">
      <SectionHead
        titleId={titleId}
        icon="bil-coins"
        title="Tokens de Uonify"
        subtitle="Pagan lo que Uony hace sin tu plan de ChatGPT: el vídeo, los botones de Uony de la ficha y lo que elijas pagar con tokens."
        actions={
          <Button variant={primary ? 'primary' : 'outline'} icon="plus" onClick={() => void openRecharge()}>
            Recargar
          </Button>
        }
      />
      {balance.isPending ? (
        <Spinner label="Cargando tu saldo…" />
      ) : balance.isError || !data ? (
        <Alert tone="red" role="alert">
          {errorMessage(balance.error, 'No se ha podido cargar tu saldo.')} <LinkButton onClick={() => void balance.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : (
        <div className="bil-balance">
          <p className="bil-balance-total">
            <strong>{tokens(data.tokens)}</strong>
            <span> · {euros(data.amount)}</span>
          </p>
          <dl className="bil-balance-split">
            <div>
              <dt>Incluidos en tu plan</dt>
              <dd>{tokensLabel(data.included.tokens, data.tokenPrice)}</dd>
              {data.included.renewsAt ? <dd className="bil-balance-note">Se renuevan el {longDate(data.included.renewsAt)}</dd> : null}
            </div>
            <div>
              <dt>Recargados</dt>
              <dd>{tokensLabel(data.recharged.tokens, data.tokenPrice)}</dd>
            </div>
          </dl>
          <p className="bil-fine">
            Primero se gastan los tokens incluidos en tu plan. Cada token vale {euros(data.tokenPrice)}
            {config.data ? `; recargas desde ${eurosShort(config.data.minRecharge)}` : ''}, sin packs ni descuentos.
          </p>
        </div>
      )}
      <Movements tokenPrice={data?.tokenPrice ?? config.data?.tokenPrice ?? 0.01} />
    </Section>
  );
}

function Movements({ tokenPrice }: { tokenPrice: number }) {
  const [limit, setLimit] = useState(PAGE);
  const titleId = useId();
  const movements = useMovements(limit);
  const list = movements.data?.movements ?? [];
  const total = movements.data?.total ?? 0;
  return (
    <div className="bil-movements">
      <h4 id={titleId} className="bil-block-title">
        Movimientos recientes
      </h4>
      {movements.isPending ? (
        <Spinner label="Cargando los movimientos…" />
      ) : movements.isError ? (
        <Alert tone="red" role="alert">
          {errorMessage(movements.error, 'No se han podido cargar los movimientos.')}{' '}
          <LinkButton onClick={() => void movements.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : list.length === 0 ? (
        <Empty icon="bil-coins" title="Aún no hay movimientos" description="Aquí verás tus recargas y lo que gasta Uony." />
      ) : (
        <>
          <ul className="bil-rows" aria-labelledby={titleId}>
            {list.map(movement => (
              <MovementRow key={movement.id} movement={movement} tokenPrice={tokenPrice} />
            ))}
          </ul>
          {total > list.length ? (
            <LinkButton onClick={() => setLimit(ALL)}>Ver más movimientos</LinkButton>
          ) : limit > PAGE && total > PAGE ? (
            <LinkButton onClick={() => setLimit(PAGE)}>Ver menos</LinkButton>
          ) : null}
        </>
      )}
    </div>
  );
}

function MovementRow({ movement, tokenPrice }: { movement: Movement; tokenPrice: number }) {
  const positive = movement.tokens > 0;
  return (
    <li className="bil-row">
      <span className="bil-row-main">
        <strong>{movement.concept}</strong>
        <small>
          <time dateTime={movement.at}>{shortDate(movement.at)}</time>
          {movement.account === 'included' ? ' · Tokens del plan' : ''}
        </small>
      </span>
      <span className={clsx('bil-row-amount', positive ? 'is-in' : 'is-out')}>
        <strong className="pim-mono">{signedNumber(movement.tokens)} tokens</strong>
        <small className="pim-mono">{euros(movement.tokens * tokenPrice)}</small>
      </span>
    </li>
  );
}
