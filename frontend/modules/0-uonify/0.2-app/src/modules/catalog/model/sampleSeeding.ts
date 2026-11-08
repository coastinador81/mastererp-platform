import type { DefaultCustomFields, PimProduct, PimScope } from '@/shared/pim';
import type { SampleDefinition } from './types';

/**
 * El producto de ejemplo trae sus pestañas rellenas (imágenes, 3D, vídeo, A+, GPSR):
 * la primera vez que se abre su ficha o se publica, y otra vez cuando el ejemplo gana
 * porciones nuevas (una versión mayor), siempre solo en las porciones aún vacías
 * (prototipo: ensureSampleSlices de app-shell.js). Devuelve si ha sembrado algo.
 */
export function seedSampleSlices(scope: Pick<PimScope, 'get' | 'set'>, sample: SampleDefinition): boolean {
  if (scope.get('sampleSeeded') === sample.version) return false;
  Object.entries(sample.slices).forEach(([slice, value]) => {
    if (scope.get(slice) === undefined) scope.set(slice, value);
  });
  scope.set('sampleSeeded', sample.version);
  return true;
}

/**
 * Atributos y Auditoría IA comparten una lista de campos personalizados: su valor
 * inicial (los del producto, o los generados de los atributos de Amazon) se pone una
 * vez, lea la pestaña que la lea primero (prototipo: pimContext de app-shell.js).
 */
export function seedCustomFields(
  scope: Pick<PimScope, 'get' | 'set'>,
  product: PimProduct | null,
  key: string,
  defaults: DefaultCustomFields | null,
): void {
  if (!product || typeof defaults !== 'function') return;
  if (scope.get('customFields') !== undefined) return;
  scope.set('customFields', defaults(product, key));
}
