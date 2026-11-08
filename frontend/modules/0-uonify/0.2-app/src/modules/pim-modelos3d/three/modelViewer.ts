/**
 * <model-viewer> de Google (paquete instalado @google/model-viewer) para el
 * «Preview 3D» de la Vista AR: se descarga la primera vez que se usa.
 */
let loading: Promise<void> | null = null;

export function loadModelViewer(): Promise<void> {
  if (typeof customElements !== 'undefined' && customElements.get('model-viewer')) return Promise.resolve();
  if (!loading) {
    loading = import('@google/model-viewer').then(() => undefined).catch(error => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
