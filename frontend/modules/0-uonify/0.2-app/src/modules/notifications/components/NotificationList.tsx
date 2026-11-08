import { useId } from 'react';
import { Empty, Icon, LinkButton, Spinner } from '@/shared/ui';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { groupByDay, type NotificationGroup } from '../model/inbox';
import type { AppNotification, NotificationsPage } from '../model/types';
import { NotificationItem } from './NotificationItem';

export interface NotificationListProps {
  page: NotificationsPage | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpen: (item: AppNotification) => void;
  onMarkRead: (id: string) => void;
  /** La primera notificación recibe el foco al abrir (hoja en móvil). */
  autoFocusFirst?: boolean;
}

function Group({ group, now, first, ...handlers }: { group: NotificationGroup; now: number; first: boolean } & Pick<NotificationListProps, 'onOpen' | 'onMarkRead' | 'autoFocusFirst'>) {
  const headingId = useId();
  return (
    <section className="ntf-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="ntf-group-title">{group.label}</h3>
      <ul className="ntf-list" role="list">
        {group.items.map((item, index) => (
          <NotificationItem
            key={item.id}
            item={item}
            now={now}
            onOpen={handlers.onOpen}
            onMarkRead={handlers.onMarkRead}
            autoFocus={Boolean(handlers.autoFocusFirst && first && index === 0)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Cuerpo del panel: cargando, error, vacío o las notificaciones por «Hoy» y «Anteriores». */
export function NotificationList({ page, loading, failed, onRetry, onOpen, onMarkRead, autoFocusFirst }: NotificationListProps) {
  const now = useMinuteClock();

  if (!page) {
    if (failed) {
      return (
        <div className="ntf-status" role="alert">
          <Icon name="alert-circle" size={20} />
          <p>No hemos podido cargar tus notificaciones.</p>
          <LinkButton onClick={onRetry}>Reintentar</LinkButton>
        </div>
      );
    }
    return (
      <div className="ntf-status">
        {loading ? <Spinner size={20} label="Cargando notificaciones…" /> : null}
      </div>
    );
  }

  if (page.items.length === 0) {
    return (
      <Empty
        className="ntf-empty"
        icon="ntf-bell"
        title="No tienes notificaciones"
        description="Aquí verás tus facturas, los avisos de límites y de Amazon, las respuestas de soporte y cuándo están listos tus vídeos y modelos 3D."
      />
    );
  }

  const groups = groupByDay(page.items, now);
  return (
    <div className="ntf-groups">
      {groups.map((group, index) => (
        <Group key={group.id} group={group} now={now} first={index === 0} onOpen={onOpen} onMarkRead={onMarkRead} autoFocusFirst={autoFocusFirst} />
      ))}
    </div>
  );
}
