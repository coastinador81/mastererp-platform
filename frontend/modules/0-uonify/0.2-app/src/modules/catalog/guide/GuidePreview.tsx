import { useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { usePimValue } from '@/shared/pim';
import { Dialog, Button } from '@/shared/ui';
import { type AplusSlice } from '@/modules/pim-aplus';
import { useProducts } from '../api/queries';
import { guideDraft } from './draft';
import { type PreviewImage, type PreviewVideo } from './amazonPreviewModel';
import { PreviewDecision, type PreviewDecisionProps } from './PreviewDecision';
import { AmazonProductView } from './AmazonProductView';
import './previewBrand.css';

/** Misma ficha y mismo borrador; solo cambia el marco visual del canal de destino. */
function AmazonProductPage({ sku }: { sku: string }) {
  useProducts();
  usePimValue(sku, 'edited', {});
  const images = usePimValue<PreviewImage[]>(sku, 'images', []);
  const video = usePimValue<{ selectedId?: string; videos?: PreviewVideo[] }>(sku, 'video', {});
  const aplus = usePimValue<AplusSlice>(sku, 'aplus', {});
  const bullets = usePimValue<string[] | null>(sku, 'bullets', null);
  const product = guideDraft(sku);
  if (!product) return <p role="status">Cargando tu ficha…</p>;
  const movie = video.videos?.find(item => item.id === video.selectedId);
  return <AmazonProductView product={product} images={images} movie={movie} aplus={aplus} bullets={bullets} />;
}

export function GuidePreview({ sku, decision }: { sku: string; decision?: PreviewDecisionProps }) {
  const [expanded, setExpanded] = useState(false);
  const leavePreview = (next: () => void) => {
    // Restaurar primero el foco del diálogo; después llevarlo al chat o al módulo.
    flushSync(() => setExpanded(false));
    next();
  };
  return <>
    <Button variant="primary" onClick={() => { setExpanded(true); decision?.review(); }}>Ver vista previa</Button>
    {expanded && createPortal(<Dialog open={expanded} onClose={() => setExpanded(false)} size="xl" className="amazon-preview-dialog" title="Tu ficha para Amazon.es" footer={decision ? <PreviewDecision {...decision}
      requestChanges={() => leavePreview(decision.requestChanges)}
      openProduct={() => leavePreview(decision.openProduct)}
      approve={() => leavePreview(decision.approve)}
    /> : <Button onClick={() => setExpanded(false)}>Volver a la conversación</Button>}>
      <AmazonProductPage sku={sku} />
    </Dialog>, document.body)}
  </>;
}
