import { useRef } from 'react';
import { Icon } from '@/shared/ui';
import { DESTINATIONS, LANGUAGES, POSTER_ACCEPT } from '../../model/constants';
import { destinationOf } from '../../model/format';
import type { Destination, VideoItem } from '../../model/types';
import { VideoSegmented } from '../VideoSegmented';

/**
 * Detalles del vídeo: destino (ficha de Amazon o anuncio), título, idioma y
 * miniatura (prototipo: detailsHTML).
 */
interface DetailsSectionProps {
  video: VideoItem;
  ids: { details: string; destination: string; title: string; language: string };
  onPatch: (patch: Partial<VideoItem>) => void;
  onPosterFrame: () => void;
  onPosterFile: (file: File | undefined) => void;
}

export function DetailsSection({ video, ids, onPatch, onPosterFrame, onPosterFile }: DetailsSectionProps) {
  const posterInput = useRef<HTMLInputElement>(null);
  const destination = destinationOf(video);
  const ads = destination === 'ads';
  return (
    <section className="pim-section is-divided" aria-labelledby={ids.details}>
      <div className="pim-section-head"><h3 className="pim-section-title" id={ids.details}>Detalles</h3></div>
      <div className="pim-video-details">
        <div className="pim-video-details-main">
          <VideoSegmented<Destination>
            labelId={ids.destination}
            label="Destino"
            value={destination}
            options={[
              { value: 'listing', label: DESTINATIONS.listing.label, icon: DESTINATIONS.listing.icon },
              { value: 'ads', label: DESTINATIONS.ads.label, icon: DESTINATIONS.ads.icon },
            ]}
            onChange={value => onPatch({ destination: value === 'ads' ? 'ads' : 'listing' })}
          />
          <div className="pim-field">
            <label className="pim-label" htmlFor={ids.title}>{ads ? 'Nombre del vídeo' : 'Título del vídeo'}</label>
            <input
              id={ids.title}
              className="pim-input"
              type="text"
              value={video.title || ''}
              placeholder={ads ? 'Para reconocerlo en Amazon Ads' : 'Qué verá tu cliente'}
              autoComplete="off"
              onChange={event => onPatch({ title: event.currentTarget.value })}
            />
            <p className="pim-hint">{ads ? 'Así lo verás en tu biblioteca de recursos de Amazon Ads.' : 'Amazon lo muestra junto al vídeo en la ficha.'}</p>
          </div>
          {ads ? null : (
            <div className="pim-field">
              <label className="pim-label" htmlFor={ids.language}>Idioma del vídeo</label>
              <select id={ids.language} className="pim-select" value={video.language || 'es'} onChange={event => onPatch({ language: event.currentTarget.value })}>
                {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="pim-field">
          <span className="pim-label">Miniatura</span>
          <div className="pim-video-poster">
            <div className="pim-thumb pim-video-poster-thumb">
              {video.poster ? <img src={video.poster} alt="Miniatura del vídeo" /> : <span className="pim-video-poster-empty"><Icon name="image" size={18} /></span>}
            </div>
            <div className="pim-video-poster-actions">
              <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={onPosterFrame}><Icon name="camera" size={14} />Usar fotograma actual</button>
              <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" onClick={() => posterInput.current?.click()}><Icon name="upload" size={14} />Subir imagen</button>
            </div>
          </div>
        </div>
      </div>
      <input
        ref={posterInput}
        type="file"
        accept={POSTER_ACCEPT}
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          onPosterFile(file);
        }}
      />
    </section>
  );
}
