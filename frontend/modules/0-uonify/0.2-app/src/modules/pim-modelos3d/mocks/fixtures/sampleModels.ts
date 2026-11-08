/**
 * Modelos glTF-Binary de ejemplo servidos en /assets (los del producto de
 * ejemplo «Make It Possible» by Uonify; triángulos y texturas medidos en cada
 * archivo). La simulación los usa cuando ya no tiene los bytes de una subida.
 */
export interface SampleModel {
  url: string;
  size: number;
  polygons: number;
  texture: string;
}

export const SAMPLE_MODELS: readonly SampleModel[] = [
  { url: '/assets/jenga/conjunto-torre-v62.glb', size: 2140424, polygons: 9664, texture: '1024x1024' },
  { url: '/assets/jenga/juego-completo.glb', size: 1916372, polygons: 9664, texture: '1024x1024' },
  { url: '/assets/packaging-uonify-v56/packaging-refined.glb', size: 17501164, polygons: 1212, texture: '3840x2640' },
];

/** Modelo de ejemplo estable para una key (el mismo en cada descarga). */
export function sampleFor(key: string): SampleModel {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return SAMPLE_MODELS[hash % SAMPLE_MODELS.length];
}
