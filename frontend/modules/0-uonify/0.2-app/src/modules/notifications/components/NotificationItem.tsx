import { useId, useRef } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { notificationMeta } from '../model/catalog';
import { formatFullDate, formatWhen } from '../model/time';
import type { AppNotification } from '../model/types';

export interface NotificationItemProps {
  item: AppNotification;
  now: number;
  /** Abrir su destino (marca como leída y cierra el panel). */
  onOpen: (item: AppNotification) => void;
  onMarkRead: (id: string) => void;
  /** Primer destino del foco al abrir la hoja en móvil. */
  autoFocus?: boolean;
}

/**
 * Una notificación: icono del tipo, título, texto y cuándo llegó. Toda la fila
 * lleva a su destino; el punto azul la marca como leída sin salir del panel.
 */
export function NotificationItem({ item, now, onOpen, onMarkRead, autoFocus = false }: NotificationItemProps) {
  const meta = notificationMeta(item.type);
  const unread = !item.readAt;
  const main = useRef<HTMLElement | null>(null);
  const setMain = (node: HTMLElement | null) => { main.current = node; };
  const id = useId();
  // Nombre corto (estado, tipo y título) y descripción aparte (texto y cuándo llegó).
  const a11y = {
    'aria-labelledby': `${id}-kind ${id}-title`,
    'aria-describedby': item.body ? `${id}-body ${id}-time` : `${id}-time`,
  };

  const content = (
    <>
      <span className={`ntf-icon ntf-tone-${meta.tone}`} aria-hidden="true">
        <Icon name={meta.icon} size={16} />
      </span>
      <span className="ntf-text">
        <span className="pim-sr-only" id={`${id}-kind`}>{unread ? 'Sin leer. ' : ''}{meta.label}:</span>
        <span className="ntf-title" id={`${id}-title`}>{item.title}</span>
        {item.body ? <span className="ntf-body" id={`${id}-body`}>{item.body}</span> : null}
        <time className="ntf-time" id={`${id}-time`} dateTime={item.createdAt} title={formatFullDate(item.createdAt)}>
          {formatWhen(item.createdAt, now)}
        </time>
      </span>
    </>
  );

  const markRead = () => {
    onMarkRead(item.id);
    // El botón desaparece: el foco pasa a la propia notificación en lugar de perderse.
    main.current?.focus();
  };

  return (
    <li className={clsx('ntf-item', unread ? 'is-unread' : 'is-read')} data-type={item.type}>
      {item.href ? (
        <Link ref={setMain} className="ntf-main" to={item.href} onClick={() => onOpen(item)} data-autofocus={autoFocus || undefined} {...a11y}>
          {content}
        </Link>
      ) : (
        <div ref={setMain} className="ntf-main" tabIndex={-1} role="group" data-autofocus={autoFocus || undefined} {...a11y}>
          {content}
        </div>
      )}
      {unread ? (
        <button type="button" className="ntf-read" aria-label={`Marcar como leída: ${item.title}`} title="Marcar como leída" onClick={markRead}>
          <span className="ntf-dot" aria-hidden="true" />
          <Icon name="check" size={14} />
        </button>
      ) : null}
    </li>
  );
}
