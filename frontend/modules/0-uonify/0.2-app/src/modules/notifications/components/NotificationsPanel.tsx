import { useEffect, useId, useRef } from 'react';
import { Dialog } from '@/shared/ui';
import type { AppNotification, NotificationsPage } from '../model/types';
import { NotificationList } from './NotificationList';
import { MarkAllButton, PreferencesLink } from './PanelActions';

export interface NotificationsPanelProps {
  id: string;
  page: NotificationsPage | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpen: (item: AppNotification) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
  /** Cierra el panel; `returnFocus` devuelve el foco a la campana. */
  onClose: (returnFocus: boolean) => void;
}

/**
 * Panel flotante bajo la campana (escritorio y tableta). No es modal: el foco
 * entra en el panel al abrirse, Escape lo cierra y vuelve a la campana, y pulsar
 * fuera lo cierra sin mover el foco (eso lo gestiona <NotificationsBell/>).
 */
export function NotificationsPopover({ id, page, onMarkAll, onClose, ...list }: NotificationsPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={panel} id={id} className="ntf-popover" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
      <header className="ntf-head">
        <div className="ntf-head-title">
          <h2 id={titleId}>Notificaciones</h2>
          
        </div>
        {page && page.items.length > 0 ? <MarkAllButton unread={page.unread} onClick={onMarkAll} /> : null}
      </header>
      <div className="ntf-scroll">
        <NotificationList page={page} {...list} />
      </div>
      <footer className="ntf-foot">
        <PreferencesLink onNavigate={() => onClose(false)} />
      </footer>
    </div>
  );
}

/**
 * Hoja inferior en móvil: diálogo modal del kit (foco atrapado, Escape, fondo y
 * vuelta del foco), con la primera notificación como destino del foco.
 */
export function NotificationsSheet({ id: _id, page, onMarkAll, onClose, ...list }: NotificationsPanelProps) {
  return (
    <Dialog
      open
      onClose={() => onClose(true)}
      className="ntf-sheet"
      title={
        <span className="ntf-head-title">
          Notificaciones 
        </span>
      }
      footer={
        <>
          <PreferencesLink onNavigate={() => onClose(false)} />
          {page && page.items.length > 0 ? <MarkAllButton unread={page.unread} onClick={onMarkAll} /> : null}
        </>
      }
    >
      <NotificationList page={page} autoFocusFirst {...list} />
    </Dialog>
  );
}
