import type { ReactNode } from 'react';
import type { ButtonVariant } from '../components/Button';
import type { IconName } from '../icons/registry';

/** Tamaños del prototipo: sm 440 px · md 560 px · lg 820 px · xl 1100 px. */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

/** Lo que recibe una acción o un cuerpo en forma de función. */
export interface DialogControls {
  /** Cierra el diálogo; `result` llega a onClose. */
  close: (result?: unknown) => void;
  /** Cambia opciones del diálogo abierto (título, acciones desactivadas…). */
  update: (patch: Partial<DialogOptions>) => void;
}

export interface DialogAction {
  label: ReactNode;
  /** Variante del botón (outline por defecto, como el prototipo). */
  variant?: ButtonVariant;
  icon?: IconName;
  /** Resultado que recibe onClose al cerrar con esta acción. */
  value?: unknown;
  disabled?: boolean;
  /** Apagado pero enfocable (aria-disabled): el clic no hace nada. */
  ariaDisabled?: boolean;
  loading?: boolean;
  className?: string;
  /**
   * Devuelve `true` (o una promesa con `true`) para dejar el diálogo abierto;
   * con cualquier otro valor se cierra con `value`.
   */
  onClick?: (controls: DialogControls) => boolean | void | Promise<boolean | void>;
}

export interface DialogOptions {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Contenido. Se pinta en <DialogHost/>, fuera del árbol que abre el diálogo:
   * no hereda contextos (router, pestaña de la ficha). Si los necesita, usa el
   * componente declarativo <Dialog> o envuelve el cuerpo con su proveedor.
   */
  body?: ReactNode | ((controls: DialogControls) => ReactNode);
  actions?: DialogAction[];
  size?: DialogSize;
  className?: string;
  /** Escape, la X y el clic fuera lo cierran (true por defecto). */
  dismissible?: boolean;
  onClose?: (result?: unknown) => void;
}

export interface DialogHandle extends DialogControls {
  id: string;
}

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Acción destructiva: botón de peligro en lugar del principal. */
  destructive?: boolean;
}
