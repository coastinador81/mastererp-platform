import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, Button } from '@/shared/ui';
import type { AplusSlice } from '@/modules/pim-aplus';
import { sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import type { PreviewImage, PreviewVideo } from './amazonPreviewModel';
import { AmazonProductView } from './AmazonProductView';

/** Muestra pública con datos del juego; no lee ni modifica el catálogo del visitante. */
export function ProductDemoPreview() {
  const [open, setOpen] = useState(false);
  const slices = sampleSlices();
  const video = slices.video as { selectedId?: string; videos?: PreviewVideo[] };
  return <>
    <button className="client-preview-primary" type="button" onClick={() => setOpen(true)}>Ver vista previa</button>
    {open && createPortal(<Dialog open onClose={() => setOpen(false)} size="xl" className="amazon-preview-dialog" title="Tu ficha para Amazon.es"
      footer={<Button onClick={() => setOpen(false)}>Volver al recorrido</Button>}>
      <AmazonProductView product={sampleProduct()} images={slices.images as PreviewImage[]} movie={video.videos?.find(item => item.id === video.selectedId)} aplus={slices.aplus as AplusSlice} />
    </Dialog>, document.body)}
  </>;
}
