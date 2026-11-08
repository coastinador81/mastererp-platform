import { useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { useLatest } from '@/shared/hooks';
import { Button } from '../components/Button';
import { Icon } from '../icons/Icon';
import { pushDialogLayer } from './dialogLayer';
import type { DialogAction, DialogControls, DialogSize } from './types';

/**
 * Marco de un diálogo modal (prototipo: <dialog class="pim-dialog">). Lo usan
 * <DialogHost/> (diálogos imperativos) y <Dialog> (declarativo).
 */
export interface DialogFrameProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: DialogAction[];
  /** Pie propio (además de, o en lugar de, `actions`). */
  footer?: ReactNode;
  size?: DialogSize;
  className?: string;
  dismissible?: boolean;
  /** Elemento al que vuelve el foco; por defecto, el que lo tenía al abrir. */
  opener?: HTMLElement | null;
  /** Petición de cierre (Escape, X, clic fuera o acción). */
  onRequestClose: (result?: unknown) => void;
  /** Controles que reciben las acciones (el diálogo imperativo añade update). */
  controls?: DialogControls;
}

// Primer destino del foco, como el prototipo: [autofocus] (en React, data-autofocus),
// el primer control del cuerpo, la X y, si no hay, la primera acción.
const FOCUS_ORDER = [
  '[autofocus], [data-autofocus]',
  '.pim-dialog-body input:not(:disabled):not([type="hidden"]), .pim-dialog-body textarea:not(:disabled), .pim-dialog-body select:not(:disabled), .pim-dialog-body button:not(:disabled)',
  '[data-dialog-close]',
  '.pim-dialog-footer button:not(:disabled)',
];

function focusInitial(element: HTMLDialogElement): void {
  for (const selector of FOCUS_ORDER) {
    const target = element.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  element.focus({ preventScroll: true });
}

export function DialogFrame({
  title,
  description,
  children,
  actions = [],
  footer,
  size = 'md',
  className,
  dismissible = true,
  opener,
  onRequestClose,
  controls,
}: DialogFrameProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const latest = useLatest({ onRequestClose, dismissible });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const previous = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // jsdom no implementa showModal: se abre con el atributo.
    if (!element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    const release = pushDialogLayer(element);
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (latest.current.dismissible) latest.current.onRequestClose();
    };
    // Si el navegador lo cierra por su cuenta, se retira también de la pila. El
    // evento «close» llega en diferido: si el diálogo ya se ha vuelto a abrir
    // (doble efecto de StrictMode en desarrollo), es de un cierre anterior.
    const onNativeClose = () => {
      if (!element.open) latest.current.onRequestClose();
    };
    element.addEventListener('cancel', onCancel);
    element.addEventListener('close', onNativeClose);
    focusInitial(element);
    return () => {
      element.removeEventListener('cancel', onCancel);
      element.removeEventListener('close', onNativeClose);
      release();
      if (typeof element.close === 'function') {
        if (element.open) element.close();
      } else element.removeAttribute('open');
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [opener, latest]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    if (dismissible) onRequestClose();
  };
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest?.('[data-dialog-close]')) {
      onRequestClose();
      return;
    }
    // Clic en el fondo: solo si el gesto empezó también fuera del panel.
    if (dismissible && target === event.currentTarget && pressedBackdrop.current) onRequestClose();
    pressedBackdrop.current = false;
  };

  const api: DialogControls = controls ?? { close: onRequestClose, update: () => {} };
  const runAction = async (action: DialogAction) => {
    if (action.ariaDisabled) return;
    const keep = await action.onClick?.(api);
    if (keep !== true) api.close(action.value);
  };

  return (
    <dialog
      ref={ref}
      className={clsx('pim-dialog', `pim-dialog-${size}`, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="pim-dialog-panel">
        <header className="pim-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {dismissible ? (
            <button type="button" className="pim-dialog-x" data-dialog-close aria-label="Cerrar">
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </header>
        <div className="pim-dialog-body">{children}</div>
        {actions.length || footer ? (
          <footer className="pim-dialog-footer">
            {footer}
            {actions.map((action, index) => (
              <Button
                key={index}
                variant={action.variant ?? 'outline'}
                icon={action.icon}
                loading={action.loading}
                disabled={action.disabled}
                aria-disabled={action.ariaDisabled || undefined}
                className={action.className}
                onClick={() => void runAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
