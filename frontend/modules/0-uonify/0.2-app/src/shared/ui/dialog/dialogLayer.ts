/**
 * Pila de diálogos modales abiertos del kit. Un <dialog> modal está en la capa
 * superior del navegador y taparía los avisos; <Toaster/> se pinta dentro del
 * último diálogo abierto para que los avisos sigan viéndose encima (como hacía
 * a mano la vista previa de Imágenes del prototipo con keepToastsVisible, y como
 * se veía en el frontend original con sonner).
 */
let layers: HTMLElement[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

/** Apunta un diálogo recién abierto; devuelve la función que lo quita. */
export function pushDialogLayer(element: HTMLElement): () => void {
  layers = [...layers.filter(layer => layer !== element), element];
  emit();
  return () => {
    const next = layers.filter(layer => layer !== element);
    if (next.length === layers.length) return;
    layers = next;
    emit();
  };
}

export function subscribeDialogLayers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** El diálogo abierto más reciente, o null. */
export function getTopDialogLayer(): HTMLElement | null {
  return layers[layers.length - 1] ?? null;
}
