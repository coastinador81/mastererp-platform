import { forwardRef } from 'react';

export type MoreAction = 'photos' | 'files' | 'image';

const ACTIONS: ReadonlyArray<{ action: MoreAction; label: string }> = [
  { action: 'photos', label: 'Añadir fotos' },
  { action: 'files', label: 'Añadir archivos' },
  { action: 'image', label: 'Crear una imagen' },
];

interface ComposerMoreMenuProps {
  id: string;
  open: boolean;
  onAction: (action: MoreAction) => void;
  onClose: () => void;
}

/** Menú «+» del compositor: añadir fotos, archivos o empezar una imagen. */
export const ComposerMoreMenu = forwardRef<HTMLDivElement, ComposerMoreMenuProps>(function ComposerMoreMenu({ id, open, onAction, onClose }, ref) {
  return (
    <div
      ref={ref}
      className="composer-more-menu"
      id={id}
      role="menu"
      aria-label="Añadir al mensaje"
      hidden={!open}
      onKeyDown={event => { if (event.key === 'Tab') onClose(); }}
    >
      {ACTIONS.map(item => (
        <button key={item.action} type="button" role="menuitem" data-more-action={item.action} onClick={() => onAction(item.action)}>{item.label}</button>
      ))}
    </div>
  );
});

/** Archivos añadidos al mensaje (chips con «Quitar»), justo debajo del campo. */
export function ComposerAttachments({ files, onRemove }: { files: readonly File[]; onRemove: (index: number) => void }) {
  return (
    <div className="composer-attachments" aria-label="Archivos añadidos" hidden={!files.length}>
      {files.map((file, index) => (
        <span className="composer-attachment" key={`${file.name}-${index}`}>
          <span>{file.name}</span>
          <button type="button" aria-label={`Quitar ${file.name}`} onClick={() => onRemove(index)}>×</button>
        </span>
      ))}
    </div>
  );
}
