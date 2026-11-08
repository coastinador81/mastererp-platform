import { createElement, forwardRef, type ReactNode } from 'react';

/** Lo que usamos del elemento <model-viewer> (@google/model-viewer 4.3). */
export interface ModelViewerElement extends HTMLElement {
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
  currentTime: number;
  duration: number;
  animationName?: string;
  availableAnimations: string[];
  play(options?: { repetitions?: number }): void;
  pause(): void;
  showPoster(): void;
}

let loading: Promise<void> | null = null;

/**
 * Carga el visor 3D bajo demanda (el PROTO importaba su copia en assets/vendor):
 * solo cuando una vista lo necesita, y se puede reintentar si falla.
 */
export function loadModelViewer(): Promise<void> {
  if (!loading) {
    loading = import('@google/model-viewer')
      .then(() => customElements.whenDefined('model-viewer'))
      .then(() => undefined)
      .catch(error => { loading = null; throw error; });
  }
  return loading;
}

/** Máxima nitidez del render (minimumRenderScale = 1, como la galería del PROTO). */
export function setMinimumRenderScale(scale: number): void {
  const viewer = customElements.get('model-viewer') as unknown as { minimumRenderScale?: number } | undefined;
  if (viewer) viewer.minimumRenderScale = scale;
}

type ViewerAttributes = Record<string, string | undefined>;

/**
 * <model-viewer> como elemento personalizado: los atributos se escriben tal cual
 * (camera-orbit, environment-image…) y el póster va como hijo con slot="poster".
 * Los eventos (load, error, finished) se enganchan con la referencia.
 */
export const ModelViewer = forwardRef<ModelViewerElement, { attributes: ViewerAttributes; children?: ReactNode }>(
  function ModelViewer({ attributes, children }, ref) {
    const props: Record<string, unknown> = { ref };
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== undefined) props[name === 'class' ? 'className' : name] = value;
    });
    return createElement('model-viewer', props, children);
  },
);
