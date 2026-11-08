import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { MESSAGES } from '../model/labels';
import { asArray, buildSnapshot, listsToSlices, loadLists, stripFile, type ListsEnv } from '../model/lists';
import type { ImageItem, ImageLists, ImageSlices, ImagesSnapshot } from '../model/types';
import { imagesMemory, isAlive, selectionOf, session, setSelection } from '../state/memory';
import { multiTenant, scrapedStorageKey } from '../state/multiTenant';

/**
 * Galería del producto sobre el almacén de la ficha (prototipo: loadLists,
 * saveLists, mutate, snapshot y las acciones de selección de pim/imagenes.js).
 * Todo trabaja con el ámbito del producto (`PimScope`): un trabajo que acaba
 * después de «Guardar y Crear» escribe en el SKU nuevo.
 */

/** URLs eliminadas de las imágenes del producto (también tras recargar). */
export const deletedOf = (scope: PimScope): Set<string> => new Set(asArray<string>(scope.get('deletedImageUrls')));

export function envFor(scope: PimScope): ListsEnv {
  return {
    info: session.products.get(scope.key) ?? null,
    catalog: imagesMemory.getState().catalog[scope.key],
    deleted: deletedOf(scope),
    isAlive,
  };
}

export const slicesOf = (scope: PimScope): ImageSlices => ({
  images: scope.get('images'),
  processedImages: scope.get('processedImages'),
  aiImages: scope.get('aiImages'),
});

export const loadListsFor = (scope: PimScope): ImageLists => loadLists(slicesOf(scope), envFor(scope));

export function saveListsFor(scope: PimScope, lists: ImageLists): void {
  const slices = listsToSlices(lists, envFor(scope));
  scope.set('processedImages', slices.processedImages);
  scope.set('aiImages', slices.aiImages);
  scope.set('images', slices.images);
}

/** Cambia las listas y las guarda (la interfaz se repinta sola al cambiar el almacén). */
export function mutate(scope: PimScope, change: (lists: ImageLists) => void): ImageLists {
  const lists = loadListsFor(scope);
  change(lists);
  saveListsFor(scope, lists);
  return lists;
}

/** Estado actual y selección sin ids obsoletos. */
export function snapshotFor(scope: PimScope): ImagesSnapshot {
  const snap = buildSnapshot(slicesOf(scope), envFor(scope), selectionOf(scope.key));
  setSelection(scope.key, snap.selection);
  return snap;
}

export const findImage = (scope: PimScope, id: string): ImageItem | null =>
  snapshotFor(scope).all.find(image => image.id === id) ?? null;

export function selectAllImages(scope: PimScope): void {
  setSelection(scope.key, snapshotFor(scope).all.map(image => image.id));
}

export function toggleImageSelection(scope: PimScope, id: string): void {
  const current = selectionOf(scope.key);
  setSelection(scope.key, current.includes(id) ? current.filter(imgId => imgId !== id) : [...current, id]);
}

/**
 * «Eliminar»: quita lo seleccionado. Lo eliminado de las imágenes del producto se
 * recuerda por URL (porción 'deletedImageUrls'); si no, volvía como «Product Image N».
 */
export function deleteSelectedImages(scope: PimScope, hasProduct: boolean): void {
  const { all, selection } = snapshotFor(scope);
  if (selection.length === 0) return;
  const removed = all.filter(image => selection.includes(image.id));
  const deleted = deletedOf(scope);
  removed.forEach(image => deleted.add(image.url));
  scope.set('deletedImageUrls', [...deleted]);
  setSelection(scope.key, []);
  const keep = (image: ImageItem) => !selection.includes(image.id);
  mutate(scope, lists => {
    lists.uploaded = lists.uploaded.filter(keep);
    lists.scraped = lists.scraped.filter(keep);
    if (hasProduct) multiTenant.setItem(scrapedStorageKey(scope.key), lists.scraped.map(stripFile));
    lists.ai = lists.ai.filter(keep);
    lists.processed = lists.processed.filter(keep);
  });
  toast.success(MESSAGES.deleted(removed.length));
}

/** «Vaciar»: quita las procesadas (y las saca de la selección). */
export function clearProcessedImages(scope: PimScope): void {
  const processedIds = new Set(loadListsFor(scope).processed.map(image => image.id));
  setSelection(scope.key, selectionOf(scope.key).filter(id => !processedIds.has(id)));
  mutate(scope, lists => {
    lists.processed = [];
  });
  toast.success(MESSAGES.processedCleared);
}
