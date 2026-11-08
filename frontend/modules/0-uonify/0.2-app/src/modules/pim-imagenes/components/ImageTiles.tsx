import type { ReactNode } from 'react';
import { Badge, IconButton, type IconName } from '@/shared/ui';
import { kilobytes } from '../model/files';
import { sourceBadge } from '../model/labels';
import type { ImageItem, ImageKind } from '../model/types';

/**
 * Miniaturas de la galería, de las procesadas y de las de IA (prototipo:
 * galleryTile, processedTile y aiTile). pim-thumb con acciones al pasar el ratón y
 * anillo azul de selección (lo pinta imagenes.css a partir de la casilla marcada);
 * el nombre y los datos técnicos van debajo, en monoespaciada.
 */

export interface TileHandlers {
  onPreview: (image: ImageItem) => void;
  onDownload: (image: ImageItem) => void;
}

function ThumbImage({ image, url }: { image: ImageItem; url?: string }) {
  return <img src={url ?? image.url} alt={image.name || ''} loading="lazy" decoding="async" draggable={false} />;
}

/** Acción de icono sobre la miniatura: el tooltip se ancla al grupo de acciones. */
function ThumbAction({ label, tooltip, icon, focus, onClick }: { label: string; tooltip: string; icon: IconName; focus: string; onClick: () => void }) {
  return (
    <IconButton icon={icon} label={label} tooltip={tooltip} tooltipAlign="end" data-focus={focus} onClick={onClick} />
  );
}

function Dims({ image }: { image: ImageItem }) {
  if (!image.dimensions || !image.dimensions.width) return null;
  return (
    <span className="pim-imagenes-dims pim-mono">
      {String(image.dimensions.width)} × {String(image.dimensions.height ?? '')}px
    </span>
  );
}

function Caption({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="pim-imagenes-caption">
      <span className="pim-imagenes-name pim-mono" title={name}>{name}</span>
      <span className="pim-imagenes-tags">{children}</span>
    </div>
  );
}

const previewLabel = (name: string, always: boolean) =>
  `Vista Previa de Imagen${always || name ? `: ${name}` : ''}`;

export function GalleryTile({ image, kind, selected, onToggle, onPreview }: {
  image: ImageItem;
  kind: ImageKind;
  selected: boolean;
  onToggle: (id: string) => void;
  onPreview: (image: ImageItem) => void;
}) {
  const name = image.name || '';
  return (
    <li className="pim-imagenes-item">
      <div className="pim-thumb pim-imagenes-thumb">
        <ThumbImage image={image} />
        <label className="pim-imagenes-check">
          <input
            type="checkbox"
            className="pim-check"
            data-focus={`select:${image.id}`}
            checked={selected}
            onChange={() => onToggle(image.id)}
            aria-label={`Seleccionar ${name || 'imagen'}`}
          />
        </label>
        <div className="pim-thumb-actions">
          <ThumbAction label={previewLabel(name, false)} tooltip="Vista Previa de Imagen" icon="eye" focus={`preview:${image.id}`} onClick={() => onPreview(image)} />
        </div>
      </div>
      <Caption name={name}>
        {kind === 'upload' ? (
          <>
            <Badge>Subida</Badge>
            {image.size ? <span className="pim-imagenes-size pim-mono">{kilobytes(image.size)}</span> : null}
          </>
        ) : <Badge>{kind === 'scrape' ? 'Scrapeada' : 'Amazon'}</Badge>}
        <Dims image={image} />
      </Caption>
    </li>
  );
}

export function ProcessedTile({ image, onPreview, onDownload }: { image: ImageItem } & TileHandlers) {
  const name = image.name || '';
  return (
    <li className="pim-imagenes-item">
      <div className="pim-thumb pim-imagenes-thumb">
        <ThumbImage image={image} url={image.processedUrl || image.url} />
        <div className="pim-thumb-actions">
          <ThumbAction label={previewLabel(name, true)} tooltip="Vista Previa de Imagen" icon="eye" focus={`preview:${image.id}`} onClick={() => onPreview(image)} />
          <ThumbAction label={`Descargar ${name}`} tooltip="Descargar" icon="download" focus={`download:${image.id}`} onClick={() => onDownload(image)} />
        </div>
      </div>
      <Caption name={name}>
        <Badge tone="green">Procesada</Badge>
        <Badge>{sourceBadge(image.source)}</Badge>
        <Dims image={image} />
      </Caption>
    </li>
  );
}

export function AiTile({ image, onPreview, onDownload }: { image: ImageItem } & TileHandlers) {
  const name = image.name || '';
  return (
    <li className="pim-imagenes-item">
      <div className="pim-thumb pim-imagenes-thumb">
        <ThumbImage image={image} />
        <div className="pim-thumb-actions">
          <ThumbAction label={previewLabel(name, true)} tooltip="Vista Previa de Imagen" icon="eye" focus={`preview:${image.id}`} onClick={() => onPreview(image)} />
          <ThumbAction label="Favorito" tooltip="Favorito" icon="heart" focus={`favorite:${image.id}`} onClick={() => onDownload(image)} />
          <ThumbAction label={`Descargar ${name}`} tooltip="Descargar" icon="download" focus={`download:${image.id}`} onClick={() => onDownload(image)} />
        </div>
      </div>
      <Caption name={name}>
        {image.style ? <Badge>{image.style}</Badge> : null}
        <Badge tone="ai">IA</Badge>
      </Caption>
    </li>
  );
}
