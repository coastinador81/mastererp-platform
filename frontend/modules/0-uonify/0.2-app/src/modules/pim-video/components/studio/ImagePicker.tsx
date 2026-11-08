import { Icon, dialog } from '@/shared/ui';
import { near } from '../../model/format';
import type { ImageRef, VideoFormat } from '../../model/types';

/**
 * Foto de partida de un plano (prototipo: pim/video.js, pickImage): las fotos de la
 * ficha, con aviso si se recortan al formato del vídeo. Sin fotos, lleva a Imágenes.
 */
interface PickerProps {
  images: ImageRef[];
  format: VideoFormat;
  selectedUrl: string;
  onPick: (image: ImageRef) => void;
  onGoImages: () => void;
}

function PickerBody({ images, format, selectedUrl, onPick, onGoImages }: PickerProps) {
  const ratio = format === '9:16' ? 9 / 16 : 16 / 9;
  if (!images.length) {
    return (
      <div className="pim-empty">
        <Icon name="image" size={24} />
        <strong>Esta ficha aún no tiene fotos</strong>
        <p>Añádelas en la pestaña Imágenes y vuelve para elegir la foto de cada plano.</p>
        <button type="button" className="pim-btn pim-btn-outline" onClick={onGoImages}><Icon name="image" size={16} />Ir a Imágenes</button>
      </div>
    );
  }
  return (
    <div className="pim-video-picker">
      <p className="pim-video-note">Es el primer fotograma del plano. Mejor una foto sin rótulos: la IA no reproduce bien los textos.</p>
      <ul className="pim-video-picker-grid" data-format={format}>
        {images.map((image, position) => {
          const sized = image.width > 0 && image.height > 0;
          return (
            <li key={`${image.id}-${position}`}>
              <button type="button" className="pim-video-picker-item" aria-pressed={image.url === selectedUrl} onClick={() => onPick(image)}>
                <span className="pim-video-picker-frame"><img src={image.url} alt="" loading="lazy" decoding="async" /></span>
                <span className="pim-video-picker-name pim-mono">{image.name || 'Imagen'}</span>
                <span className="pim-video-picker-meta">
                  {sized ? <span className="pim-mono">{image.width} × {image.height}</span> : null}
                  {sized && !near(image.width, image.height, ratio) ? <span>Se recorta a {format}</span> : null}
                  {image.source === 'ai-generated' ? <span>IA</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface OpenPickerOptions extends Omit<PickerProps, 'onPick' | 'onGoImages'> {
  shotNumber: number;
  onPick: (image: ImageRef) => void;
  onGoImages: () => void;
}

export function openImagePicker({ shotNumber, images, format, selectedUrl, onPick, onGoImages }: OpenPickerOptions): void {
  dialog.open({
    title: `Foto del plano ${shotNumber}`,
    description: images.length ? `Formato del vídeo: ${format}.` : '',
    size: images.length ? 'lg' : 'sm',
    actions: [{ label: 'Cancelar', variant: 'outline' }],
    body: ({ close }) => (
      <PickerBody
        images={images}
        format={format}
        selectedUrl={selectedUrl}
        onPick={image => { close(); onPick(image); }}
        onGoImages={() => { close(); onGoImages(); }}
      />
    ),
  });
}
