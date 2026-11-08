import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { drivePreviewUrl, driveFileViewUrl, type EstudioCard } from '../model/estudioCard';
import { sendPrompt } from '../hooks/conversation';
import { focusComposer } from '../hooks/actions';

function clock(totalSec: number | undefined): string {
  if (!totalSec || totalSec < 0) return '0:00';
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Visor del Estudio: vista ampliada de una pieza en una ventana modal. Cambiar
 *  de versión o de escena se pide por la conversación; no se simula reproducción. */
export function EstudioViewer({ card, onClose }: { card: EstudioCard; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const items = card.items ?? [];
  const current = items[selected];
  const versions = Math.max(1, card.version ?? 1);
  const total = card.meta?.durationSec ?? items.reduce((sum, item) => sum + (item.durationSec ?? 0), 0);
  // Descargar: downloadUrl real del backend (descarga directa) o, de apaño, la VISTA del archivo en Drive (evita el
  // 403 del enlace `uc?export=download` cuando el clip vive en el Drive de otra cuenta). El cliente descarga desde Drive.
  const downloadHref = card.downloadUrl ?? (card.previewFileId ? driveFileViewUrl(card.previewFileId) : current?.playUrl);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="estudio-viewer-scrim" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="estudio-viewer" role="dialog" aria-modal="true" aria-label={card.title} tabIndex={-1} ref={panel}>
        <header className="estudio-viewer-head">
          <div>
            <h2>{card.title}</h2>
            {card.meta ? <p>{[card.meta.durationSec ? `${card.meta.durationSec} s` : null, card.meta.aspect, card.meta.resolution].filter(Boolean).join(' · ')}</p> : null}
          </div>
          <div className="estudio-viewer-tools">
            {versions > 1 ? (
              <div className="estudio-versions" role="tablist" aria-label="Versiones">
                {Array.from({ length: versions }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" role="tab" aria-selected={n === versions}
                    className={clsx('estudio-version', n === versions && 'is-current')}
                    onClick={() => { if (n !== versions) sendPrompt(`Enséñame la versión ${n}.`); }}>
                    Versión {n}{n === versions ? ' · actual' : ''}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="estudio-viewer-close" aria-label="Cerrar el visor" onClick={onClose}><Icon name="x" size={18} /></button>
          </div>
        </header>
        <div className="estudio-viewer-stage">
          {card.previewFileId ? (
            // Preview NATIVO en el Drive del cliente (fileId opaco, card-safe). No reproducimos nosotros.
            <iframe className="estudio-viewer-drive" src={drivePreviewUrl(card.previewFileId)} title={card.title} allow="autoplay" />
          ) : (
            <>
              {current?.posterUrl ? <img src={current.posterUrl} alt="" /> : null}
              <span className="estudio-player-play"><Icon name="play" size={24} /></span>
              {current ? <span className="estudio-viewer-caption">Escena {current.index} · {current.subtitle ?? current.title}</span> : null}
              <span className="estudio-viewer-time">0:00 / {clock(total)}</span>
            </>
          )}
        </div>
        {/* Tira de escenas SOLO con varias escenas: con un único clip sería un recuadro redundante bajo el vídeo
            (el dueño lo leía como «un segundo vídeo»). La miniatura es imagen/ícono ligero, nunca otro reproductor. */}
        {items.length > 1 ? (
          <div className="estudio-strip">
            {items.map((item, i) => (
              <button key={item.index} type="button" className={clsx('estudio-strip-item', i === selected && 'is-selected')} onClick={() => setSelected(i)}>
                <span className="estudio-thumb is-ready">{item.posterUrl ? <img src={item.posterUrl} alt="" /> : <Icon name="play" size={16} />}</span>
                <span className="estudio-strip-label">{item.index} · {item.title}{item.durationSec ? ` · ${item.durationSec} s` : ''}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="estudio-actions estudio-viewer-actions">
          <button type="button" className="estudio-secondary" onClick={focusComposer}><Icon name="refresh-cw" size={14} /> Cambiar una escena</button>
          <button type="button" className="estudio-secondary" disabled={!downloadHref} onClick={() => { if (downloadHref) window.open(downloadHref, '_blank', 'noopener'); }}><Icon name="download" size={14} /> Descargar</button>
          <button type="button" className="estudio-primary" onClick={() => sendPrompt('Sí, publícalo.')}>Publicar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
