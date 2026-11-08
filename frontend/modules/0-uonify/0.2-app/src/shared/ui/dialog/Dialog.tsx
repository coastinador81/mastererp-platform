import type { ReactNode } from 'react';
import { DialogFrame } from './DialogFrame';
import type { DialogAction, DialogSize } from './types';

/**
 * Diálogo declarativo con el mismo aspecto y comportamiento que `dialog.open`,
 * pintado dentro del árbol que lo usa (hereda contextos: router, pestaña, datos).
 *
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Publicar" size="lg"
 *     footer={<Button variant="primary" onClick={publish}>Publicar</Button>}>…</Dialog>
 */
export interface DialogProps {
  open: boolean;
  /** Escape, la X, el clic fuera o una acción; recibe el `value` de la acción. */
  onClose: (result?: unknown) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  className?: string;
  dismissible?: boolean;
  actions?: DialogAction[];
  footer?: ReactNode;
  children?: ReactNode;
}

export function Dialog({ open, onClose, children, ...frame }: DialogProps) {
  if (!open) return null;
  return (
    <DialogFrame {...frame} onRequestClose={onClose}>
      {children}
    </DialogFrame>
  );
}
