import { Badge } from '@/shared/ui';
import { useConnections, useMfa } from '../../hooks/queries';
import { useConnectionActions } from '../../hooks/useConnect';
import { LoadError, Loading, SettingsCard } from '../common';
import { AmazonCard } from './AmazonCard';
import { ChatGptCard } from './ChatGptCard';

/** Conexiones: plan de ChatGPT, Amazon Seller Central y Shopify (próximamente). Nunca se guardan claves en el navegador. */
export function ConnectionsSection() {
  const connections = useConnections();
  const mfa = useMfa();
  const actions = useConnectionActions();

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
        badge={<Badge tone="blue">Próximamente</Badge>}
        description="Sincroniza los productos y el stock de tu tienda Shopify."
        className="is-muted"
      />
    </div>
  );
}
