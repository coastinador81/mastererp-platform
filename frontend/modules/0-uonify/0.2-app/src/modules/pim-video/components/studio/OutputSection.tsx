import { Icon } from '@/shared/ui';
import { AUDIO_NOTICE, DESTINATIONS } from '../../model/constants';
import type { Destination, VideoFormat } from '../../model/types';
import { VideoSegmented } from '../VideoSegmented';

/**
 * Formato (16:9 o 9:16; el anuncio, solo 16:9) y audio, con el aviso aprobado de
 * consumo de saldo (prototipo: outputHTML).
 */
interface OutputSectionProps {
  ids: { output: string; format: string; audio: string };
  destination: Destination;
  format: VideoFormat;
  audio: boolean;
  onFormat: (format: VideoFormat) => void;
  onAudio: (audio: boolean) => void;
}

export function OutputSection({ ids, destination, format, audio, onFormat, onAudio }: OutputSectionProps) {
  const spec = DESTINATIONS[destination];
  const hint = destination === 'ads'
    ? '1920 × 1080, como piden Sponsored Brands y display. El anuncio solo admite 16:9.'
    : format === '9:16' ? '1080 × 1920 (Full HD vertical).' : '1920 × 1080 (Full HD).';
  return (
    <section className="pim-section is-divided" aria-labelledby={ids.output}>
      <div className="pim-section-head"><h3 className="pim-section-title" id={ids.output}>Formato y audio</h3></div>
      <div className="pim-video-output">
        <div className="pim-video-output-item">
          <VideoSegmented<VideoFormat>
            labelId={ids.format}
            label="Formato"
            value={format}
            options={[
              { value: '16:9', label: 'Horizontal 16:9' },
              { value: '9:16', label: 'Vertical 9:16', disabled: spec.formats.includes('9:16') ? false : 'El anuncio solo admite 16:9' },
            ]}
            onChange={onFormat}
          />
          <p className="pim-hint">{hint}</p>
        </div>
        <div className="pim-video-output-item">
          <VideoSegmented<'on' | 'off'>
            labelId={ids.audio}
            label="Audio"
            value={audio ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Con audio', icon: 'volume-2' },
              { value: 'off', label: 'Sin audio', icon: 'volume-x' },
            ]}
            onChange={value => onAudio(value === 'on')}
          />
        </div>
      </div>
      <p className="pim-video-notice"><Icon name="info" size={14} /><span>{AUDIO_NOTICE}</span></p>
    </section>
  );
}
