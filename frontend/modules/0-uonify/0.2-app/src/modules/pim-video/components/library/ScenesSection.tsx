import { Icon, toast } from '@/shared/ui';
import { asArray, formatTime } from '../../model/format';
import type { Chapter, VideoItem } from '../../model/types';
import type { Detection } from '../../jobs/jobsStore';

/**
 * Escenas: saltos a cada momento del vídeo y «Detectar escenas» (prototipo: scenesHTML).
 * La escena en curso lleva aria-current; solo una detección a la vez por producto.
 */
interface ScenesSectionProps {
  video: VideoItem;
  headingId: string;
  detection: Detection | null;
  activeIndex: number;
  onDetect: () => void;
  onSeek: (time: number, index: number) => void;
}

const OTHER = 'Ya se están detectando las escenas de otro vídeo';

export function ScenesSection({ video, headingId, detection, activeIndex, onDetect, onSeek }: ScenesSectionProps) {
  const busyHere = Boolean(detection && detection.videoId === video.id);
  const other = Boolean(detection && !busyHere);
  const chapters = asArray<Chapter>(video.chapters);
  const progress = detection?.progress ?? 0;

  const onClick = () => {
    if (busyHere) return;
    if (other) { toast.info(OTHER); return; }
    onDetect();
  };

  return (
    <section className="pim-section is-divided" aria-labelledby={headingId}>
      <div className="pim-section-head">
        <div>
          <h3 className="pim-section-title" id={headingId}>Escenas{chapters.length ? <span className="pim-badge">{chapters.length}</span> : null}</h3>
        </div>
        <div className="pim-section-actions">
          <button
            type="button"
            className="pim-btn pim-btn-outline pim-btn-sm"
            aria-disabled={busyHere || other || undefined}
            aria-busy={busyHere || undefined}
            data-tooltip={other ? OTHER : undefined}
            data-tooltip-align={other ? 'end' : undefined}
            onClick={onClick}
          >
            {busyHere ? <Icon name="loader" size={14} className="pim-spin" /> : <Icon name="scan" size={14} />}
            {busyHere ? 'Detectando…' : 'Detectar escenas'}
          </button>
        </div>
      </div>
      {busyHere ? (
        <div className="pim-video-progress">
          <div className="pim-video-progress-head"><span>Analizando fotogramas…</span><span className="pim-mono" aria-hidden="true">{progress}%</span></div>
          <div className="pim-progress" role="progressbar" aria-label="Detectando escenas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      {chapters.length ? (
        <ol className="pim-video-scenes">
          {chapters.map((chapter, index) => (
            <li key={`${chapter.time}-${index}`}>
              <button
                type="button"
                className="pim-video-scene"
                aria-label={`Ir a ${chapter.title}, ${formatTime(chapter.time)}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                onClick={() => onSeek(Number(chapter.time) || 0, index)}
              >
                <span className="pim-thumb pim-video-scene-thumb">
                  {chapter.thumb ? <img src={chapter.thumb} alt="" loading="lazy" decoding="async" /> : null}
                  <span className="pim-video-scene-play" aria-hidden="true"><Icon name="play" size={12} /></span>
                </span>
                <span className="pim-video-scene-time pim-mono">{formatTime(chapter.time)}</span>
                <span className="pim-video-scene-title">{chapter.title}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pim-video-note">Marca los momentos clave del vídeo para revisarlo y elegir su miniatura.</p>
      )}
    </section>
  );
}

/** Escena en curso: la última que empieza antes del momento del reproductor. */
export function activeScene(chapters: Chapter[] | undefined, time: number): number {
  let active = -1;
  asArray<Chapter>(chapters).forEach((chapter, index) => {
    if (time + 0.05 >= chapter.time) active = index;
  });
  return active;
}
