import { useId, useState, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Zona para soltar archivos (prototipo: .pim-dropzone; `.is-over` al arrastrar
 * encima). Incluye un <input type="file"> invisible: `open()` lo abre y su id sirve
 * para una <label htmlFor> con aspecto de botón («Seleccionar»), como en Imágenes.
 * Con `clickable`, toda la zona es un botón que abre el selector (A+).
 */
export interface DropzoneRenderApi {
  open: () => void;
  inputId: string;
  isOver: boolean;
}

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  clickable?: boolean;
  /** Contenido por defecto: icono, título y ayuda. */
  icon?: IconName;
  title?: ReactNode;
  hint?: ReactNode;
  className?: string;
  /** Nombre accesible de la zona clicable o del campo de archivo. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  children?: ReactNode | ((api: DropzoneRenderApi) => ReactNode);
}

function filesOf(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  clickable = false,
  icon = 'upload-cloud',
  title = 'Arrastra archivos aquí',
  hint,
  className,
  children,
  ...aria
}: DropzoneProps) {
  const inputId = useId();
  // El campo se guarda en estado (no en ref) para poder dar open() al contenido.
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [isOver, setOver] = useState(false);

  const open = () => {
    if (!disabled) input?.click();
  };
  const activate = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setOver(true);
  };
  const leave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOver(false);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    if (disabled) return;
    const files = filesOf(event.dataTransfer?.files);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  const api: DropzoneRenderApi = { open, inputId, isOver };
  const content = typeof children === 'function'
    ? children(api)
    : children ?? (
      <>
        <Icon name={icon} size={24} />
        <strong>{title}</strong>
        {hint ? <span className="pim-hint">{hint}</span> : null}
      </>
    );
  // Sin <label htmlFor> propia (contenido por defecto), el campo toma el título como nombre.
  const inputLabel = aria['aria-label'] ?? (children === undefined && typeof title === 'string' ? title : undefined);
  const fileInput = (
    <input
      ref={setInput}
      id={inputId}
      type="file"
      // Con zona clicable el botón recibe el foco; si no, el campo sigue siendo
      // alcanzable con el teclado (oculto a la vista, con el foco en la zona).
      hidden={clickable}
      className={clickable ? undefined : 'pim-sr-only'}
      accept={accept}
      multiple={multiple}
      disabled={disabled}
      aria-label={clickable ? undefined : inputLabel}
      aria-describedby={clickable ? undefined : aria['aria-describedby']}
      onChange={event => {
        const files = filesOf(event.target.files);
        event.target.value = '';
        if (files.length) onFiles(files);
      }}
    />
  );
  const classes = clsx('pim-dropzone', isOver && 'is-over', disabled && 'is-disabled', className);
  const handlers = { onDragEnter: activate, onDragOver: activate, onDragLeave: leave, onDrop: drop };

  if (clickable) {
    return (
      <>
        <button type="button" className={classes} disabled={disabled} onClick={open} {...handlers} {...aria}>
          {content}
        </button>
        {fileInput}
      </>
    );
  }
  return (
    <div className={classes} {...handlers}>
      {fileInput}
      {content}
    </div>
  );
}
