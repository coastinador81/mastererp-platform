import { useState } from 'react';
import { Badge, Button } from '@/shared/ui';
import { useConnections, useMfa } from '../../hooks/queries';
import { useConnectionActions } from '../../hooks/useConnect';
import { LoadError, Loading, SettingsCard } from '../common';
import { AmazonCard } from './AmazonCard';
import { ChatGptCard } from './ChatGptCard';

/** Conexiones: plan de ChatGPT, Amazon Seller Central y Shopify (activación a petición). Nunca se guardan claves en el navegador. */
export function ConnectionsSection() {
  const connections = useConnections();
  const mfa = useMfa();
  const actions = useConnectionActions();
  const [shopifyRequested, setShopifyRequested] = useState(false);

  if (connections.isPending || mfa.isPending) return <Loading />;
  if (connections.isError) return <LoadError error={connections.error} onRetry={() => void connections.refetch()} />;
  const data = connections.data;

  return (
    <div className="uset-stack">
      <ChatGptCard connection={data.chatgpt} actions={actions} />
      <AmazonCard connection={data.amazon} mfaEnabled={mfa.data?.enabled === true} actions={actions} />
      <SettingsCard
        title="Shopify"
        icon="uset-store"
        badge={<Badge tone="blue">{shopifyRequested ? 'Solicitada' : 'Disponible bajo solicitud'}</Badge>}
        description="Sincroniza los productos y el stock de tu tienda Shopify."
        actions={shopifyRequested ? undefined : <Button variant="primary" size="sm" onClick={() => setShopifyRequested(true)}>Solicitar activación</Button>}
      >
        {shopifyRequested ? <p className="uset-card-sub" role="status">Solicitud registrada: activaremos esta conexión en tu espacio.</p> : null}
      </SettingsCard>
    </div>
  );
}
