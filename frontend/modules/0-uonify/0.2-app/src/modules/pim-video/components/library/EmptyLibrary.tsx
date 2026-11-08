import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { useDropZone } from '../../hooks/useDropZone';

/** Sin vídeos: subir uno (acción sólida) o crearlo con Uony (prototipo: emptyHTML). */
interface EmptyLibraryProps {
  onUpload: () => void;
  onCreate: () => void;
  onDropFile: (file: File | undefined) => void;
}

export function EmptyLibrary({ onUpload, onCreate, onDropFile }: EmptyLibraryProps) {
  const drop = useDropZone(onDropFile);
  return (
    <section className={clsx('pim-card pim-card-dashed pim-video-empty', drop.over && 'is-over')} {...drop.props}>
      <div className="pim-empty">
        <span className="pim-video-empty-icon"><Icon name="video" size={24} /></span>
        <strong>Añade el vídeo de tu producto</strong>
        <p>Arrástralo aquí o elígelo en tu equipo. MP4 o MOV, hasta 5 GB. O créalo con Uony a partir de las fotos de la ficha.</p>
        <div className="pim-video-empty-actions">
          <button type="button" className="pim-btn pim-btn-primary" data-action="upload" onClick={onUpload}><Icon name="upload" size={16} />Subir vídeo</button>
          <button type="button" className="pim-btn pim-btn-ai" onClick={onCreate}><Icon name="uony" size={16} />Crear con Uony</button>
        </div>
      </div>
    </section>
  );
}
