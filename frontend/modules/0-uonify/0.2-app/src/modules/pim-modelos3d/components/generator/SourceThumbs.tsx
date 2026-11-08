import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import type { ImageSource, SourceImage } from '../../model/types';

export interface SourcePreview {
  url: string;
  name: string;
  owned: boolean;
}

/**
 * Miniaturas de «Imágenes Fuente» (máx. 8): una object URL por archivo subido,
 * creadas una vez y revocadas al cerrar el diálogo (E38). La revocación espera
 * un instante para que el doble efecto de StrictMode no las anule en desarrollo.
 */
export function useSourcePreviews(imageSource: ImageSource, customImages: File[], source: SourceImage[]): SourcePreview[] {
  const [previews] = useState<SourcePreview[]>(() => (imageSource === 'upload'
    ? customImages.slice(0, 8).map(file => ({ url: URL.createObjectURL(file), name: file.name, owned: true }))
    : source.slice(0, 8).map(image => ({ url: image.url, name: image.name || 'image', owned: false }))));
  const revoke = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(revoke.current);
    return () => {
      revoke.current = setTimeout(() => {
        previews.forEach(preview => { if (preview.owned) URL.revokeObjectURL(preview.url); });
      }, 0);
    };
  }, [previews]);
  return previews;
}

export function SourceThumbs({ label, previews, total }: { label: string; previews: SourcePreview[]; total: number }) {
  return (
    <section className="pim-modelos3d-group">
      <h4 className="pim-modelos3d-subtitle"><Icon name="image" size={16} /> Imágenes Fuente ({label})</h4>
      <div className="pim-modelos3d-thumbs">
        {previews.map((preview, index) => (
          <div className="pim-thumb" key={`${preview.url}-${index}`}>
            <img src={preview.url} alt={preview.name} loading="lazy" />
          </div>
        ))}
        {total > 8 ? <div className="pim-thumb pim-modelos3d-thumb-more"><span>+{total - 8}</span></div> : null}
      </div>
    </section>
  );
}
