import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { useDropZone } from '../../hooks/useDropZone';
import { destinationOf, formatLabel, formatSize, formatTime } from '../../model/format';
import type { VideoItem } from '../../model/types';

/**
 * Vídeos del producto: filas compactas; el elegido, en azul (prototipo: listHTML).
 * Admite soltar un vídeo encima.
 */
interface VideoListProps {
  videos: VideoItem[];
  selectedId: string | null;
  headingId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpload: () => void;
  onDropFile: (file: File | undefined) => void;
}

export function VideoList({ videos, selectedId, headingId, onSelect, onDelete, onUpload, onDropFile }: VideoListProps) {
  const drop = useDropZone(onDropFile);
  return (
    <section className={clsx('pim-section is-divided', drop.over && 'is-over')} aria-labelledby={headingId} {...drop.props}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={headingId}>Vídeos del producto<span className="pim-badge">{videos.length}</span></h3>
        <div className="pim-section-actions">
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-action="upload" onClick={onUpload}><Icon name="upload" size={14} />Subir vídeo</button>
        </div>
      </div>
      <ul className="pim-video-list">
        {videos.map(video => {
          const selected = video.id === selectedId;
          const sub = [video.duration ? formatTime(video.duration) : '', formatSize(video.size), formatLabel(video)].filter(Boolean).join(' · ');
          return (
            <li key={video.id} className={clsx('pim-video-row', selected && 'is-selected')}>
              <button type="button" className="pim-video-row-select" aria-pressed={selected} onClick={() => onSelect(video.id)}>
                <span className="pim-video-row-thumb">
                  {video.poster ? <img src={video.poster} alt="" loading="lazy" decoding="async" /> : <Icon name="video" size={16} />}
                </span>
                <span className="pim-video-row-meta">
                  <span className="pim-video-row-name pim-mono">{video.name}</span>
                  <span className="pim-video-row-sub">
                    <span className="pim-mono">{sub}</span>
                    <span className="pim-video-row-dest">{destinationOf(video) === 'ads' ? 'Anuncio' : 'Ficha'}{video.generation ? ' · IA' : ''}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="pim-btn pim-btn-ghost pim-btn-icon pim-video-remove"
                aria-label={`Eliminar ${video.name}`}
                data-tooltip="Eliminar"
                data-tooltip-align="end"
                onClick={() => onDelete(video.id)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
