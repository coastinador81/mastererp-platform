import type { RefObject, SyntheticEvent } from 'react';
import clsx from 'clsx';
import { useLatest } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import { cannotSeek, wholeFile } from '../../lib/media';
import { crossOrigin, formatSize, formatTime, near } from '../../model/format';
import type { VideoItem } from '../../model/types';
import { OriginLine } from './OriginLine';

/**
 * Reproductor del vídeo elegido, con sus datos técnicos y «Descargar» (prototipo:
 * stageHTML y mountPlayer). El mismo <video> sigue sonando al cambiar el destino,
 * el título… (React lo conserva mientras no cambien el vídeo ni su URL).
 */
interface VideoStageProps {
  video: VideoItem;
  player: RefObject<HTMLVideoElement | null>;
  onDownload: () => void;
  onMetadata: (id: string, patch: Partial<VideoItem>) => void;
  onTime: (time: number) => void;
}

export function VideoStage({ video, player, onDownload, onMetadata, onTime }: VideoStageProps) {
  const remote = crossOrigin(video.url);
  const latest = useLatest(video);

  const onLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget;
    const source = element.dataset.source || '';
    // Sin HTTP Range el vídeo se carga entero una vez y se reproduce desde memoria.
    if (cannotSeek(element) && !/^(blob|data):/.test(element.currentSrc || element.src)) {
      wholeFile(source).then(local => {
        if (!element.isConnected || element.dataset.source !== source) return;
        const time = element.currentTime;
        const playing = !element.paused;
        element.src = local;
        element.currentTime = time;
        if (playing) element.play().catch(() => {});
      }, () => {});
    }
    const live = latest.current;
    if (live.url !== source) return;
    const patch: Partial<VideoItem> = {};
    if (Number.isFinite(element.duration) && Math.abs((live.duration || 0) - element.duration) > 0.05) patch.duration = Math.round(element.duration * 10) / 10;
    if (element.videoWidth && element.videoWidth !== live.width) patch.width = element.videoWidth;
    if (element.videoHeight && element.videoHeight !== live.height) patch.height = element.videoHeight;
    if (Object.keys(patch).length) onMetadata(live.id, patch);
  };

  const facts = [
    video.name,
    video.width ? `${video.width} × ${video.height}` : '',
    video.duration ? formatTime(video.duration) : '',
    formatSize(video.size),
    video.codecs || '',
  ].filter(Boolean);

  return (
    <section className="pim-video-stage" aria-label="Reproductor">
      <div className={clsx('pim-video-frame', near(video.width, video.height, 9 / 16) && 'is-vertical')}>
        <video
          key={`${video.id}|${video.url}`}
          ref={player}
          className="pim-video-player"
          controls
          playsInline
          preload="metadata"
          crossOrigin={remote ? 'anonymous' : undefined}
          src={video.url}
          data-source={video.url}
          poster={video.poster || undefined}
          aria-label={video.title || video.name}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={event => onTime(event.currentTarget.currentTime)}
        />
      </div>
      <div className="pim-video-caption">
        <div className="pim-video-caption-row">
          <h3 className="pim-video-title">{video.title || video.name}</h3>
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={onDownload}><Icon name="download" size={14} />Descargar</button>
        </div>
        <div className="pim-meta pim-video-facts">
          {facts.map((fact, index) => <span key={index} className="pim-mono">{fact}</span>)}
        </div>
        <OriginLine generation={video.generation} />
      </div>
    </section>
  );
}
