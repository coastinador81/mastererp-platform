import { Link } from 'react-router';
import { Alert, Badge, Button, buttonClass, dialog, KeyValue } from '@/shared/ui';
import type { useConnectionActions } from '../../hooks/useConnect';
import { AMAZON_DATA_DELETION_DAYS, amazonView, maskSellerId, type AmazonView } from '../../model/connections';
import { formatDate } from '../../model/format';
import { settingsPath } from '../../model/sections';
import type { AmazonConnection } from '../../model/types';
import { SettingsCard } from '../common';

export interface AmazonCardProps {
  connection: AmazonConnection;
  mfaEnabled: boolean;
  actions: ReturnType<typeof useConnectionActions>;
}

function badgeFor(view: AmazonView) {
  switch (view.kind) {
    case 'connected': return view.renewSoon ? <Badge tone="amber">Caduca pronto</Badge> : <Badge tone="green">Conectada</Badge>;
    case 'expired': return <Badge tone="red">Caducada</Badge>;
    case 'revoked': return <Badge tone="red">Permiso retirado</Badge>;
    default: return <Badge>Sin conectar</Badge>;
  }
}

/**
 * Amazon Seller Central (Amazon.es). Solo se conecta con la verificación en dos
 * pasos activada (lo exige la política de datos de Amazon). La autorización dura
 * 365 días; al desconectar, los datos de Amazon se borran en un plazo de 30 días.
 */
export function AmazonCard({ connection, mfaEnabled, actions }: AmazonCardProps) {
  const view = amazonView(connection, mfaEnabled);
  const busy = actions.connect.isPending || actions.renew.isPending || actions.disconnect.isPending;
  const connecting = actions.connect.isPending && actions.connect.variables === 'amazon';

  const confirmDisconnect = async () => {
    const ok = await dialog.confirm({
      title: '¿Desconectar Amazon Seller Central?',
      description: `Uonify dejará de leer y publicar en tu tienda de ${connection.marketplace}. Borraremos los datos obtenidos de Amazon en un plazo de ${AMAZON_DATA_DELETION_DAYS} días, como exige su política de protección de datos. Lo que has creado en Uonify se conserva.`,
      confirmLabel: 'Desconectar y borrar datos',
      destructive: true,
    });
    if (ok) actions.disconnect.mutate('amazon');
  };

  const disconnectButton = (
    <Button size="sm" variant="ghost" onClick={() => void confirmDisconnect()} loading={actions.disconnect.isPending} disabled={busy}>Desconectar</Button>
  );

  return (
    <SettingsCard
      title="Amazon Seller Central"
      icon="uset-store"
      badge={<>{badgeFor(view)}</>}
      description={`Importa tus productos y publica tus fichas en ${connection.marketplace}.`}
    >
      {view.kind === 'needs-mfa' ? (
        <>
          <Alert tone="info" role="note" title="Antes, activa la verificación en dos pasos">
            Amazon la exige para conectar tu cuenta de vendedor y proteger los datos de tu tienda.
          </Alert>
          <div className="uset-card-foot">
            <Link to={settingsPath('seguridad')} className={buttonClass('primary', 'sm')}>Activar la verificación en dos pasos</Link>
          </div>
        </>
      ) : null}

      {view.kind === 'disconnected' ? (
        <>
          {view.deletionBy ? (
            <p className="pim-small pim-muted">Los datos de Amazon de la conexión anterior se borrarán antes del {formatDate(view.deletionBy)}.</p>
          ) : (
            <p className="pim-small pim-muted">Te llevaremos a Seller Central para que autorices a Uonify. La autorización dura 365 días y puedes retirarla cuando quieras.</p>
          )}
          <div className="uset-card-foot">
            <Button variant="primary" size="sm" onClick={() => actions.connect.mutate('amazon')} loading={connecting} disabled={busy}>Conectar Amazon</Button>
          </div>
        </>
      ) : null}

      {view.kind === 'connected' ? (
        <>
          <KeyValue items={[
            { label: 'Vendedor', value: connection.sellerName ?? '—' },
            { label: 'ID de vendedor', value: maskSellerId(connection.sellerId), mono: true },
            { label: 'Marketplace', value: connection.marketplace },
            { label: 'Autorizada el', value: formatDate(connection.authorizedAt) },
            { label: 'Caduca el', value: `${formatDate(connection.expiresAt)} (quedan ${view.daysLeft} ${view.daysLeft === 1 ? 'día' : 'días'})` },
          ]} />
          {view.renewSoon ? (
            <Alert tone="amber" role="status">La autorización de Amazon caduca en {view.daysLeft} {view.daysLeft === 1 ? 'día' : 'días'}. Renuévala para no cortar la sincronización.</Alert>
          ) : null}
          <p className="pim-small pim-muted">También puedes retirar el permiso en Seller Central › Aplicaciones y servicios › Administrar tus aplicaciones.</p>
          <div className="uset-card-foot">
            <Button variant={view.renewSoon ? 'primary' : 'outline'} size="sm" onClick={() => actions.renew.mutate()} loading={actions.renew.isPending} disabled={busy}>Renovar autorización</Button>
            {disconnectButton}
          </div>
        </>
      ) : null}

      {view.kind === 'expired' || view.kind === 'revoked' ? (
        <>
          <Alert tone="red" role="status">
            {view.kind === 'expired'
              ? 'La autorización de Amazon ha caducado y Uonify ya no puede leer ni publicar en tu tienda.'
              : 'Retiraste el permiso desde Seller Central y Uonify ya no puede leer ni publicar en tu tienda.'}
          </Alert>
          <div className="uset-card-foot">
            <Button variant="primary" size="sm" onClick={() => actions.renew.mutate()} loading={actions.renew.isPending} disabled={busy || !mfaEnabled}>Volver a autorizar</Button>
            {disconnectButton}
          </div>
        </>
      ) : null}
    </SettingsCard>
  );
}
