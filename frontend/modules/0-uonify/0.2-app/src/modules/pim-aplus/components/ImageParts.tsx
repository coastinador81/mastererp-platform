import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Button, Icon, IconButton } from '@/shared/ui';
import { PROCESSING_PLACEHOLDER } from '../model/constants';
import { formatMB } from '../model/imageRules';
import type { AplusImage } from '../model/types';
import { rescueFocus } from './focus';

/** APlusImageWithFallback: sin URL o si falla, «Procesando...». */
export function FallbackImg({ image, className, alt }: { image: AplusImage | null | undefined; className: string; alt?: string }) {
  return (
    <img
      className={className}
      src={image?.url || PROCESSING_PLACEHOLDER}
      alt={alt ?? image?.altText ?? ''}
      data-fallback=""
      loading="lazy"
      decoding="async"
      onError={event => {
        const img = event.currentTarget;
        if (img.src !== PROCESSING_PLACEHOLDER) img.src = PROCESSING_PLACEHOLDER;
      }}
    />
  );
}

export interface ImagePanelProps {
  image: AplusImage;
  focusKey: string;
  /** Sección (cuatro imágenes). */
  index?: number | null;
  /** Miniatura compacta de cuatro imágenes: acciones solo con icono. */
  compact?: boolean;
  labels?: [string, string];
  onPreview: () => void;
  onRemove: () => void;
}

/** Imagen colocada: miniatura con acciones al pasar el puntero y, debajo, su estado y medidas. */
export function ImagePanel({ image, focusKey, index = null, compact = false, labels = ['Válida', 'Errores'], onPreview, onRemove }: ImagePanelProps) {
  const dims = image.dimensions || { width: 0, height: 0 };
  const valid = image.isValid !== false;
  const n = (index ?? 0) + 1;
  return (
    <figure className={clsx('pim-aplus-image', compact && 'pim-aplus-image-compact')}>
      <div className={clsx('pim-thumb pim-aplus-thumb', !valid && 'is-invalid')}>
        <FallbackImg image={image} className="pim-aplus-image-img" />
        <div className="pim-thumb-actions">
          {compact ? (
            <>
              <IconButton icon="eye" label="Vista previa del módulo" tooltipAlign="end" onClick={onPreview} />
              <IconButton icon="trash" label={`Eliminar imagen ${n}`} tooltipAlign="end" className="pim-aplus-img-remove" data-focus-key={focusKey} onClick={onRemove} />
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" icon="eye" onClick={onPreview}>Vista previa</Button>
              <Button variant="ghost" size="sm" icon="trash" className="pim-aplus-img-remove" data-focus-key={focusKey} onClick={onRemove}>Eliminar</Button>
            </>
          )}
        </div>
      </div>
      <figcaption className="pim-aplus-image-meta">
        <span className={clsx('pim-badge', valid ? 'pim-badge-green' : 'pim-badge-red')}>
          <Icon name={valid ? 'check-circle' : 'alert-triangle'} size={12} />
          {valid ? labels[0] : labels[1]}
        </span>
        <span className="pim-mono">{`${dims.width} × ${dims.height}px`}</span>
        <span className="pim-mono">{formatMB(image.size)}</span>
      </figcaption>
      {valid ? null : (
        <div className="pim-aplus-image-errors">
          {(image.validationErrors || []).map((error, i) => (
            <p key={i}>
              <Icon name="alert-triangle" size={12} />
              {error}
            </p>
          ))}
        </div>
      )}
    </figure>
  );
}

export interface ImageDropzoneProps {
  title: string;
  text: string;
  hint?: string;
  focusKey: string;
  compact?: boolean;
  /** Clic: abre «Cargar imagen». */
  onOpen: () => void;
  /** Archivo soltado encima. */
  onFile: (file: File) => void;
}

/** Zona de imagen vacía (pim-dropzone como botón): clic abre el diálogo; admite soltar. */
export function ImageDropzone({ title, text, hint, focusKey, compact = false, onOpen, onFile }: ImageDropzoneProps) {
  const [over, setOver] = useState(false);
  const onDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    event.preventDefault();
    setOver(false);
  };
  return (
    <button
      type="button"
      className={clsx('pim-dropzone pim-aplus-drop', compact && 'pim-aplus-drop-compact', over && 'pim-aplus-drop-over')}
      data-focus-key={focusKey}
      onClick={onOpen}
      onDragOver={event => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={onDragLeave}
      onDrop={event => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) onFile(file);
      }}
    >
      <Icon name="upload" size={compact ? 18 : 22} />
      <strong>{title}</strong>
      <span>{text}</span>
      {hint ? <small className="pim-mono">{hint}</small> : null}
    </button>
  );
}

/**
 * Hueco de imagen (data-slot del prototipo). Cuando cambia entre zona vacía e
 * imagen y el foco se ha perdido, lo lleva al control principal del hueco (la
 * zona o «Eliminar»).
 */
export function ImageSlot({ hasImage, children }: { hasImage: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(hasImage);
  useEffect(() => {
    if (previous.current === hasImage) return;
    previous.current = hasImage;
    rescueFocus(ref.current);
  }, [hasImage]);
  return (
    <div className="pim-aplus-slot" ref={ref}>
      {children}
    </div>
  );
}
