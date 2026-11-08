import { Button } from '@/shared/ui';

export interface PreviewDecisionProps {
  reviewed: boolean;
  published: boolean;
  busy: boolean;
  requestChanges(): void;
  openProduct(): void;
  review(): void;
  approve(): void;
}

/** Revisión y aprobación dentro del visor modal. */
export function PreviewDecision({ reviewed, published, busy, requestChanges, openProduct, review, approve }: PreviewDecisionProps) {
  return <div className="uony-preview-decision">
    <div aria-live="polite">
      <strong>{published ? 'Esta versión ya está publicada' : reviewed ? '¿Lo publicamos así?' : 'La ficha ha cambiado'}</strong>
      <p>{published ? 'Puedes pedir cambios y revisar la nueva versión antes de publicarla.' : reviewed ? 'Pide cambios por voz o por escrito, o di «aprobado, súbelo».' : 'Revisa la versión actual antes de aprobarla.'}</p>
    </div>
    <div className="uony-preview-decision-actions">
      <Button variant="ai" icon="uony" disabled={busy} onClick={requestChanges}>Pedir cambios con Uony</Button>
      <Button disabled={busy} onClick={openProduct}>Abrir en Producto</Button>
      {!published && <Button variant="primary" disabled={busy} onClick={reviewed ? approve : review}>{reviewed ? 'Aprobar y publicar' : 'Revisar versión actual'}</Button>}
    </div>
  </div>;
}
