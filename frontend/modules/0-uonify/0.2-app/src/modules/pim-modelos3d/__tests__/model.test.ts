import { DEFAULT_3D } from '../model/constants';
import { cap, fileNameOf, mb2, utf8Base64 } from '../model/format';
import { computeImageSets, generateDisabled, productImages, sourceMessage } from '../model/images';
import { scanStaleBlobURLs } from '../model/pageState';
import { CLEAR_SELECTION, isFileSelected, merge3D, normalize3D, ownFiles, selectedMetadata, showsModelBlock, staleStatePatch } from '../model/state';
import type { Model3DFile } from '../model/types';

const file = (key: string, url: string, extra: Partial<Model3DFile> = {}): Model3DFile => ({ key, url, size: 2140424, ...extra });

describe('porción model3d (get3D / set3D)', () => {
  test('normaliza con los valores por defecto y fuerza la categoría de suelo (selector retirado)', () => {
    expect(normalize3D(null)).toEqual(DEFAULT_3D);
    expect(normalize3D('roto').selected3DModel).toBeNull();
    const state = normalize3D({ model3DCategory: 'wall', uploadId: 'upl_1' });
    expect(state.model3DCategory).toBe('floor');
    expect(state.uploadId).toBe('upl_1');
  });

  test('set3D mezcla valores por defecto, lo guardado y el cambio', () => {
    expect(merge3D({ uploadId: 'upl_1', selected3DModel: 'a.glb' }, { selected3DModel: null })).toEqual({
      ...DEFAULT_3D,
      uploadId: 'upl_1',
      selected3DModel: null,
    });
  });

  test('ownFiles solo cuenta archivos con url y key', () => {
    const files = [file('modelos/a.glb', '/a.glb', { local: true }), { key: '', url: '/b.glb', size: 1 }, null];
    expect(ownFiles({ files: files as Model3DFile[] })).toHaveLength(1);
    expect(ownFiles({})).toEqual([]);
  });

  test('selección por URL o, si la URL cambió, por key (E21)', () => {
    const glb = file('output/upl_1/torre.glb', 'blob:nuevo');
    expect(isFileSelected(glb, { selected3DModel: 'blob:nuevo', selectedKey: null })).toBe(true);
    expect(isFileSelected(glb, { selected3DModel: 'blob:viejo', selectedKey: 'output/upl_1/torre.glb' })).toBe(true);
    expect(isFileSelected(glb, { selected3DModel: null, selectedKey: 'output/upl_1/torre.glb' })).toBe(false);
    const withMeta = file('k', 'u', { metadata: { polygons: 9664 } });
    expect(selectedMetadata([withMeta], { selected3DModel: 'u', selectedKey: 'k' })).toEqual({ polygons: 9664 });
    expect(selectedMetadata([withMeta], { selected3DModel: 'x', selectedKey: null })).toBeNull();
  });

  test('al montar se descartan las blob: URLs de otra carga y una generación que ya no corre', () => {
    const state = { ...DEFAULT_3D, selected3DModel: 'blob:http://x/1', isGenerating3D: true, generation3DProgress: 45 };
    expect(staleStatePatch(state, { isDeadBlob: () => true, hasActiveGeneration: false })).toEqual({
      ...CLEAR_SELECTION,
      isGenerating3D: false,
      generation3DProgress: 0,
    });
    expect(staleStatePatch(state, { isDeadBlob: () => false, hasActiveGeneration: true })).toBeNull();
  });

  test('el bloque del modelo aparece con modelo, generación o archivos listados', () => {
    expect(showsModelBlock(DEFAULT_3D, 0)).toBe(false);
    expect(showsModelBlock(DEFAULT_3D, 2)).toBe(true);
    expect(showsModelBlock({ ...DEFAULT_3D, isGenerating3D: true }, 0)).toBe(true);
  });
});

describe('imágenes para generar (useImageManager)', () => {
  test('sin galería usa las imágenes del producto', () => {
    const fallback = productImages('UON-1', ['a.jpg', { url: 'b.jpg' }, { nope: 1 }]);
    expect(fallback.map(image => image.name)).toEqual(['Product Image 1', 'Product Image 2']);
    const sets = computeImageSets({ processedImages: null, images: null, aiImages: null, fallback }, new Set());
    expect(sets.all).toHaveLength(2);
  });

  test('quita duplicados y las blob: URLs de una carga anterior (E29)', () => {
    const sets = computeImageSets({
      images: [{ id: '1', url: 'a.jpg' }, { id: '2', url: 'blob:viejo' }],
      aiImages: [{ id: '1', url: 'a.jpg' }, { id: '3', url: 'c.jpg' }],
      processedImages: [{ id: 'p', url: 'blob:vivo' }],
      fallback: [],
    }, new Set(['blob:viejo']));
    expect(sets.all.map(image => image.id)).toEqual(['1', '3', 'p']);
    expect(sets.processed).toHaveLength(1);
  });

  test('«Generar Modelo 3D» y los avisos de «Fuente de Imágenes»', () => {
    const empty = { processed: [], all: [] };
    const some = { processed: [{ url: 'p.jpg' }, { url: 'q.jpg' }], all: [{ url: 'a.jpg' }] };
    expect(generateDisabled('gallery', empty, 0)).toBe(true);
    expect(generateDisabled('gallery', some, 0)).toBe(false);
    expect(generateDisabled('upload', some, 0)).toBe(true);
    expect(sourceMessage('gallery', empty, 0)).toEqual({ tone: 'warning', text: 'Agrega imágenes en la pestaña "Imágenes"' });
    expect(sourceMessage('gallery', some, 0)).toEqual({ tone: 'success', text: 'Usando 2 procesadas' });
    expect(sourceMessage('upload', some, 0)).toEqual({ tone: 'warning', text: 'Selecciona imágenes para generar el modelo' });
    expect(sourceMessage('upload', some, 3)).toBeNull();
  });
});

describe('utilidades', () => {
  test('textos y tamaños como el original', () => {
    expect(cap('front')).toBe('Front');
    expect(mb2(2140424)).toBe('2.04 MB');
    expect(fileNameOf('modelos/UON-KIT-01/torre-25-piezas.glb')).toBe('torre-25-piezas.glb');
  });

  test('E49: base64 en UTF-8 de nombres fuera de Latin-1', () => {
    const encoded = utf8Base64('Make It Possible · Año 🎲');
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
    expect(decoded).toBe('Make It Possible · Año 🎲');
  });

  test('las blob: URLs guardadas en la sesión son de una carga anterior', () => {
    const storage = { length: 1, key: () => 'uonify-pim-v1', getItem: () => '{"images":[{"url":"blob:http://x/abc"}]}' };
    expect([...scanStaleBlobURLs(storage)]).toEqual(['blob:http://x/abc']);
    expect(scanStaleBlobURLs(null).size).toBe(0);
  });
});
