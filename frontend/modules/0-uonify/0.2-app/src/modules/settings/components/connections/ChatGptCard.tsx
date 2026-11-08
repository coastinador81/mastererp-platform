import { Badge, Button, dialog, KeyValue } from '@/shared/ui';
import type { useConnectionActions } from '../../hooks/useConnect';
import { chatGptBadge, chatGptPlanLabel } from '../../model/connections';
import { formatDate } from '../../model/format';
import type { ChatGptConnection } from '../../model/types';
import { SettingsCard } from '../common';

export interface ChatGptCardProps {
  connection: ChatGptConnection;
  actions: ReturnType<typeof useConnectionActions>;
}

/** Plan de ChatGPT: con él conectado, Uony usa el plan del cliente; sin él, tokens de Uonify (que requieren un plan). */
export function ChatGptCard({ connection, actions }: ChatGptCardProps) {
  const badge = chatGptBadge(connection);
  const connected = connection.status === 'connected';
  const busy = actions.connect.isPending || actions.disconnect.isPending;

  const confirmDisconnect = async () => {
    const ok = await dialog.confirm({
      title: '¿Desconectar ChatGPT?',
      description: 'Uony dejará de usar tu plan de ChatGPT. Para seguir usando Uony necesitarás tokens de Uonify, que requieren un plan de Uonify. Nunca cambiaremos la forma de pago sin que tú lo elijas.',
      confirmLabel: 'Desconectar',
      destructive: true,
    });
    if (ok) actions.disconnect.mutate('chatgpt');
  };

  return (
    <SettingsCard
      title="ChatGPT"
      icon="link"
      badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
      description="Con ChatGPT conectado, Uony usa tu plan de ChatGPT en el chat, las descripciones, las imágenes, la auditoría, el 3D y las automatizaciones."
    >
      {connected ? (
        <>
          <KeyValue items={[
            { label: 'Cuenta', value: connection.email ?? '—' },
            { label: 'Plan', value: chatGptPlanLabel(connection.plan) },
            { label: 'Conectado el', value: formatDate(connection.connectedAt) },
          ]} />
          <p className="pim-small pim-muted">También puedes desconectar Uonify desde los ajustes de tu cuenta de ChatGPT.</p>
          <div className="uset-card-foot">
            <Button size="sm" variant="ghost" onClick={() => void confirmDisconnect()} loading={actions.disconnect.isPending} disabled={busy}>Desconectar</Button>
          </div>
        </>
      ) : (
        <>
          <p className="pim-small pim-muted">
            {connection.status === 'expired'
              ? 'La conexión con ChatGPT ha caducado. Vuelve a conectarla para que Uony use tu plan.'
              : 'Sin ChatGPT, Uony funciona con tokens de Uonify, que requieren un plan de Uonify.'}
          </p>
          <div className="uset-card-foot">
            <Button size="sm" onClick={() => actions.connect.mutate('chatgpt')} loading={actions.connect.isPending && actions.connect.variables === 'chatgpt'} disabled={busy}>
              {connection.status === 'expired' ? 'Volver a conectar' : 'Conectar ChatGPT'}
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
