import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { useMediaQuery } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import '../icons';
import { useAnnouncement } from '../hooks/announcer';
import { useMarkAllRead, useMarkRead, useNotifications } from '../hooks/useNotifications';
import { badgeText, bellLabel } from '../model/inbox';
import type { AppNotification } from '../model/types';
import { NotificationsPopover, NotificationsSheet } from './NotificationsPanel';
import '../styles/notifications.css';

/** Por debajo de este ancho la lista se abre como hoja inferior (móvil). */
export const NOTIFICATIONS_SHEET_QUERY = '(max-width: 640px)';

export interface NotificationsBellProps {
  /** Clase extra para ajustarla a la cabecera que la monta. */
  className?: string;
}

/**
 * Campana de notificaciones de la cabecera del espacio: contador de no leídas,
 * lista agrupada en «Hoy» y «Anteriores», marcar como leída (una o todas) y
 * enlace a las preferencias. Consulta el backend cada 60 s.
 */
export function NotificationsBell({ className }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const compact = useMediaQuery(NOTIFICATIONS_SHEET_QUERY);
  const wrapper = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const panelId = useId();
  const announcement = useAnnouncement();
  const query = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const page = query.data;
  const unread = page?.unread ?? 0;
  const newestUnread = page?.items.find(item => !item.readAt)?.id ?? '';

  const close = useCallback((returnFocus: boolean) => {
    restoreFocus.current = returnFocus;
    setOpen(false);
  }, []);

  // Tras cerrar con Escape (o la X de la hoja), el foco vuelve a la campana.
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    bell.current?.focus({ preventScroll: true });
  }, [open]);

  // Panel flotante: pulsar fuera lo cierra (la hoja móvil lo hace con su fondo).
  useEffect(() => {
    if (!open || compact) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, compact, close]);

  const toggle = () => {
    if (open) {
      close(false);
      return;
    }
    setOpen(true);
    if (query.isStale && !query.isFetching) void query.refetch();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open || compact || event.defaultPrevented) return;
    // Así el espacio no cierra además la hoja de la conversación con la misma tecla.
    event.preventDefault();
    close(true);
  };

  // Salir del panel con Tab lo cierra, como un menú desplegable.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!open || compact) return;
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) close(false);
  };

  const onOpenItem = (item: AppNotification) => {
    if (!item.readAt) markRead.mutate(item.id);
    close(false);
  };

  const panelProps = {
    id: panelId,
    page,
    loading: query.isPending,
    failed: query.isError,
    onRetry: () => void query.refetch(),
    onOpen: onOpenItem,
    onMarkRead: (id: string) => markRead.mutate(id),
    onMarkAll: () => markAll.mutate(),
    onClose: close,
  };

  return (
    <div ref={wrapper} className="ntf" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={bell}
        type="button"
        className={clsx('ntf-bell', className)}
        aria-label={bellLabel(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !compact ? panelId : undefined}
        data-tooltip="Notificaciones"
        data-tooltip-pos="below"
        onClick={toggle}
      >
        <Icon name="ntf-bell" size={20} />
        {unread > 0 ? (
          <span key={newestUnread} className="ntf-count" aria-hidden="true" data-testid="notifications-count">
            {badgeText(unread)}
          </span>
        ) : null}
      </button>
      <span className="pim-sr-only" role="status" aria-live="polite">{announcement}</span>
      {open ? compact ? <NotificationsSheet {...panelProps} /> : <NotificationsPopover {...panelProps} /> : null}
    </div>
  );
}
