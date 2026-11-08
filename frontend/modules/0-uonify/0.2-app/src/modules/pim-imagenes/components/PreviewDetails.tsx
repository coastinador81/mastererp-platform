import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon, type BadgeTone } from '@/shared/ui';
import { megabytes } from '../model/files';
import { sourceEmoji, sourceText, statusInfo, type StatusInfo, type StatusTone } from '../model/labels';
import type { ImageItem } from '../model/types';

/**
 * Detalle de la imagen en la vista previa (prototipo: factHTML y la columna de
 * detalles de renderPreview): etiqueta arriba, valor debajo; los datos técnicos
 * en monoespaciada y el emoji del original al final. El color solo marca el
 * estado real (insignia semántica).
 */

const STATUS_TONE: Record<StatusTone, BadgeTone> = { green: 'green', purple: 'ai', red: 'red', amber: 'neutral' };

const order = (i: number) => ({ '--i': i }) as CSSProperties;

function Fact({ index, label, value, mono = false, emoji = '', status = null }: {
  index: number;
  label: string;
  value: ReactNode;
  mono?: boolean;
  emoji?: string;
  status?: StatusInfo | null;
}) {
  const tone = status ? STATUS_TONE[status.tone] : 'neutral';
  return (
    <div className="pim-imagenes-fact" style={order(index)}>
      <dt>{label}</dt>
      <dd>
        {status ? (
          <span className={clsx('pim-badge', tone !== 'neutral' && `pim-badge-${tone}`)}>
            <Icon name={status.icon} size={12} />
            {value}
          </span>
        ) : (
          <span className={clsx('pim-imagenes-fact-value', mono && 'pim-mono')}>{value}</span>
        )}
        {emoji ? <span className="pim-imagenes-fact-emoji" aria-hidden="true">{emoji}</span> : null}
      </dd>
    </div>
  );
}

export interface PreviewDetailsProps {
  image: ImageItem;
  index: number;
  count: number;
  entering: boolean;
  onDownload: () => void;
  onClose: () => void;
}

export function PreviewDetails({ image, index, count, entering, onDownload, onClose }: PreviewDetailsProps) {
  const status = statusInfo(image.status);
  const dims = image.dimensions;
  return (
    <>
      <h3 className="pim-imagenes-details-title">Detalles de la Imagen</h3>
      <dl className={clsx('pim-imagenes-facts', entering && 'is-entering')}>
        <Fact index={1} label="Nombre del archivo" value={image.name ?? ''} mono />
        {image.size ? <Fact index={2} label="Tamaño del archivo" value={megabytes(image.size)} mono /> : null}
        {dims ? <Fact index={3} label="Dimensiones" value={`${String(dims.width ?? '')} x ${String(dims.height ?? '')}px`} mono /> : null}
        <Fact index={4} label="Fuente" value={sourceText(image.source)} emoji={sourceEmoji(image.source)} />
        <Fact index={5} label="Estado" value={status.text} emoji={status.badge} status={status} />
      </dl>
      <div className={clsx('pim-imagenes-indicator', entering && 'is-entering')} style={order(6)}>
        <span aria-live="polite">Imagen {index + 1} de {count}</span>
        <span className="pim-imagenes-dots" aria-hidden="true">
          {Array.from({ length: Math.min(count, 5) }, (_, i) => (
            <span key={i} className={clsx('pim-imagenes-dot', i === index % 5 && 'is-active')} />
          ))}
          {count > 5 ? <small>+{count - 5}</small> : null}
        </span>
      </div>
      <div className="pim-imagenes-viewer-actions">
        <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-focus="download" onClick={onDownload}>
          <Icon name="download" size={14} />
          Descargar
        </button>
        <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-focus="favorite" onClick={onDownload}>
          <Icon name="heart" size={14} />
          Favorito
        </button>
      </div>
      <button type="button" className="pim-btn pim-btn-primary pim-btn-block" data-focus="close" onClick={onClose}>
        <Icon name="x" size={16} />
        Cerrar vista previa
      </button>
    </>
  );
}
