import { useCallback, useEffect, useId, useRef } from 'react';
import { usePimScope } from '@/shared/pim';
import { SubTabs } from '@/shared/ui';
import { TEXT_MAX } from '../model/constants';
import { videoCount } from '../model/format';
import { isActive } from '../model/project';
import type { VideoView } from '../model/types';
import { afterPaint } from '../lib/focus';
import { startPolling } from '../jobs/polling';
import { readStudioFrom } from '../jobs/scope';
import { useProductData } from '../hooks/useProductData';
import { useVideoLibrary, useVideoView } from '../hooks/useVideoData';
import { LibraryView } from './library/LibraryView';
import { StudioView } from './studio/StudioView';

/**
 * Pestaña «Vídeo» de la ficha (clave 'video'; prototipo: pim/video.js). Dos vistas:
 * «Vídeos del producto» (biblioteca) y «Crear con Uony» (estudio). Una sola acción
 * sólida por vista; aqua solo en lo que hace la IA; datos técnicos en monoespaciada.
 */
export function VideoTab() {
  const scope = usePimScope();
  const root = useRef<HTMLDivElement>(null);
  const base = useId();
  const ids = { panel: `${base}-panel`, tabLibrary: `${base}-tab-library`, tabCreate: `${base}-tab-create`, textHint: `${base}-text-hint` };
  const productView = useProductData();
  const library = useVideoLibrary();
  const [view, setView] = useVideoView(library.videos.length > 0);
  const name = String(productView.product.name || '');
  const sku = productView.savedSku;

  // El seguimiento en segundo plano nombra el producto al añadir el resultado.
  useEffect(() => { scope.set('productInfo', { name, sku }); }, [scope, name, sku]);

  // Un vídeo que se estaba generando al salir (o al recargar) sigue su seguimiento.
  useEffect(() => {
    const project = readStudioFrom(scope).project;
    if (project && isActive(project)) startPolling(scope, project.id);
  }, [scope]);

  /** Cambia de vista desde un botón de dentro y lleva el foco a su pestaña. */
  const goTo = useCallback((next: VideoView) => {
    setView(next);
    afterPaint(() => document.getElementById(next === 'create' ? ids.tabCreate : ids.tabLibrary)?.focus({ preventScroll: true }));
  }, [setView, ids.tabCreate, ids.tabLibrary]);

  return (
    <div className="pim-video" ref={root}>
      <header className="pim-head">
        <div className="pim-head-row"><h2>Vídeo</h2><span className="pim-badge pim-video-count">{videoCount(library.videos.length)}</span></div>
        <p>El producto en movimiento, listo para la ficha y los anuncios de Amazon.</p>
      </header>
      <SubTabs<VideoView>
        className="pim-video-views"
        aria-label="Vistas de vídeo"
        value={view}
        onChange={setView}
        options={[
          { value: 'library', label: 'Vídeos del producto', icon: 'video', id: ids.tabLibrary, controls: ids.panel },
          { value: 'create', label: 'Crear con Uony', icon: 'uony', id: ids.tabCreate, controls: ids.panel },
        ]}
      />
      <div className="pim-video-body" id={ids.panel} role="tabpanel" aria-labelledby={view === 'create' ? ids.tabCreate : ids.tabLibrary}>
        {view === 'create'
          ? <StudioView root={root} library={library} productView={productView} textHintId={ids.textHint} setView={goTo} />
          : <LibraryView root={root} library={library} productView={productView} onCreate={() => goTo('create')} />}
      </div>
      <span className="pim-sr-only" id={ids.textHint}>Hasta {TEXT_MAX} caracteres.</span>
    </div>
  );
}
