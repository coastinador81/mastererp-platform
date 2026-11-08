import { describe, expect, it } from 'vitest';
import { countDownloadedImages, createImageObject, mapAmazonModulesToUI } from '../model/amazon';
import { countMissingImages, mapModulesToBackend } from '../model/backend';
import { cacheImage, cacheKeyOf, readCachedData, snapshotData } from '../model/cache';
import { CACHE_TTL, FI, SP, TO } from '../model/constants';
import { applyField, createModule, removeBullet, uploadTarget, withModuleImage } from '../model/content';
import { buildSuggestedImage, getProductEcosystemData, readEcosystemSources } from '../model/ecosystem';
import type { AplusCacheData, AplusImage, AplusModule } from '../model/types';
import { validateModule } from '../model/validation';
import { seedContentDocument } from '../mocks/fixtures/seedDocument';
import { generateAplusCopy } from '../mocks/generator';

const image = (overrides: Partial<AplusImage> = {}): AplusImage => ({
  id: 'img',
  url: 'blob:local',
  altText: 'Imagen',
  dimensions: { width: 970, height: 300 },
  size: 1000,
  format: 'image/jpeg',
  isValid: true,
  validationErrors: [],
  ...overrides,
});

describe('envío al backend (E22)', () => {
  it('mismo payload que el original: altText «Imagen», dummy sin subida, sin viñetas vacías ni encabezados', () => {
    const overlay = createModule('text-overlay', 'a');
    const specs = createModule('specifications', 'b');
    const four = createModule('four-images', 'c');
    const modules = [
      { ...overlay, content: { headline: 'Hola', bodyText: 'Cuerpo', backgroundImage: image({ uploadDestinationId: 'aplus-media/sc/1.jpg' }) } },
      { ...specs, content: { ...(specs.content as object), mainHeadline: 'Caja', bulletPoints: ['25 piezas', '   ', ''] } },
      four,
      { id: 'd', type: 'header-image', title: 'Imagen de encabezado estándar', content: { headline: '', image: null }, isValid: true, validationErrors: [] },
    ] as AplusModule[];
    const payload = mapModulesToBackend(modules);
    expect(payload).toEqual([
      { type: 'STANDARD_IMAGE_TEXT_OVERLAY', fields: { uploadDestinationId: 'aplus-media/sc/1.jpg', altText: 'Imagen', headline: 'Hola', subheadline: 'Cuerpo', width_px: 970, height_px: 300 } },
      { type: 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL', fields: { uploadDestinationId: 'dummy-image-id', altText: 'Imagen', headline: 'Caja', specs: [{ label: '25 piezas' }] } },
      { type: 'STANDARD_FOUR_IMAGE_TEXT', fields: { images: Array(4).fill('dummy-image-id'), texts: ['', '', '', ''] } },
    ]);
    expect(countMissingImages(payload)).toBe(2);
  });
});

describe('contenido de Amazon → módulos', () => {
  it('traduce el documento publicado de ejemplo, con imágenes descargadas o de relleno', async () => {
    const downloaded = new Set(['aplus-media/sc/uonify-banda-01.jpg', 'aplus-media/sc/uonify-caja.jpg']);
    const modules = await mapAmazonModulesToUI(
      seedContentDocument('B0TEST').contentModuleList ?? [],
      async id => (id && downloaded.has(id) ? 'data:image/jpeg;base64,AAA' : null),
      42,
    );
    expect(modules.map(module => module.type)).toEqual(['text-overlay', 'four-images', 'specifications']);
    const [overlay, four, specs] = modules;
    if (overlay.type !== 'text-overlay' || four.type !== 'four-images' || specs.type !== 'specifications') throw new Error('tipos');
    expect(overlay.id).toBe('module-42-0');
    expect(overlay.content.backgroundImage?.url).toBe('data:image/jpeg;base64,AAA');
    expect(four.content.sections[0].image?.url).toBe('https://placehold.co/220x220/e5e7eb/6b7280?text=Imagen+1');
    expect(four.content.sections[0].image?.altText).toMatch(/\(placeholder\)$/);
    expect(specs.content.blocks).toEqual([{ headline: 'Tres personajes, un solo juego', subtitle: 'Productos, ERP y Agentes', body: expect.stringContaining('bandeja') }]);
    expect(specs.content.bulletPoints).toHaveLength(7);
    expect(countDownloadedImages(modules)).toBe(2);
  });

  it('el contenido de ejemplo cumple las normas A+ de la pestaña y no usa marcas ajenas', async () => {
    const modules = await mapAmazonModulesToUI(seedContentDocument('B0TEST').contentModuleList ?? [], async () => 'data:image/jpeg;base64,AAA');
    expect(modules.length).toBeLessThanOrEqual(5);
    for (const module of modules) expect(validateModule(module)).toEqual([]);
    expect(JSON.stringify(seedContentDocument('B0TEST'))).not.toMatch(/jenga/i);
  });

  it('createImageObject sin imagen usa el relleno del original', () => {
    const img = createImageObject(null, 'x', 1, 2, undefined, { width: 970, height: 300 }, 'Alt');
    expect(img).toMatchObject({ id: 'img-1-2', url: 'https://placehold.co/970x300/e5e7eb/6b7280?text=Imagen+A%2B', altText: 'Alt (placeholder)', uploadDestinationId: 'x' });
  });
});

describe('caché de la pestaña (productos sin ASIN)', () => {
  const data = (modules: AplusModule[] = []): AplusCacheData => ({ modules, brand: 'Uonify', hasUnsavedChanges: true, availableDocuments: [], selectedDocumentKey: '' });

  it('A+ guarda los módulos de un producto sin ASIN en «local», sin caducidad', () => {
    expect(cacheKeyOf(undefined)).toBe('local');
    expect(cacheKeyOf('B0ABC')).toBe('B0ABC');
    const old = Date.now() - CACHE_TTL * 10;
    const slice = { content: { local: { data: data(), timestamp: old }, B0ABC: { data: data(), timestamp: old } } };
    expect(readCachedData(slice, 'local', false).data).not.toBeNull();
    expect(readCachedData(slice, 'B0ABC', true)).toEqual({ data: null, expired: true });
    expect(readCachedData(slice, 'B0ABC', true, old + 1000).data).not.toBeNull();
  });

  it('no guarda las imágenes descargadas que se pueden volver a pedir ni el archivo', () => {
    expect(cacheImage(image({ url: 'data:image/jpeg;base64,AAA', uploadDestinationId: 'aplus-media/sc/1.jpg' }))?.url).toBeNull();
    expect(cacheImage(image({ url: 'data:image/jpeg;base64,AAA', uploadDestinationId: 'dummy-image-id' }))?.url).toBe('data:image/jpeg;base64,AAA');
    const module = createModule('four-images', 'm');
    const withImage = { ...module, content: withModuleImage(module, 2, image({ url: 'data:x', uploadDestinationId: 'id-2' })) } as AplusModule;
    const snapshot = snapshotData(data([withImage]));
    const four = snapshot.modules[0];
    if (four.type !== 'four-images') throw new Error('tipo');
    expect(four.content.sections[2].image).toMatchObject({ url: null, file: null, uploadDestinationId: 'id-2' });
  });
});

describe('cambios de contenido', () => {
  it('applyField cambia bloques, viñetas y secciones sin tocar el resto', () => {
    const specs = createModule('specifications', 's');
    if (specs.type !== 'specifications') throw new Error('tipo');
    const next = applyField(applyField(specs.content, 'block.subtitle', 0, 'Sub'), 'bullet', 0, 'Viñeta');
    expect(next.blocks[0]).toEqual({ headline: '', subtitle: 'Sub', body: '' });
    expect(next.bulletPoints).toEqual(['Viñeta']);
    expect(removeBullet(next, 0)).toBeNull();
    const four = createModule('four-images', 'f');
    const changed = applyField(four.content, 'section.bodyText', 3, 'Texto');
    expect((changed as { sections: { bodyText: string }[] }).sections[3].bodyText).toBe('Texto');
  });

  it('uploadTarget da las medidas mínimas y el texto alternativo de cada hueco', () => {
    expect(uploadTarget(createModule('text-overlay', 'a'), null)).toEqual({ minW: TO.minW, minH: TO.minH, altText: 'Imagen de fondo para módulo de superposición' });
    expect(uploadTarget(createModule('specifications', 'b'), null)?.minW).toBe(SP.minW);
    expect(uploadTarget(createModule('four-images', 'c'), 1)).toEqual({ minW: FI.minW, minH: FI.minH, altText: 'Imagen para sección 2' });
    expect(uploadTarget(createModule('four-images', 'c'), null)).toBeNull();
  });
});

describe('datos para Uony', () => {
  const product = { name: 'Make It Possible by Uonify', sku: 'UON-KIT-01', brand: 'Uonify', category: 'Juguetes', description: '' };
  const fields = [
    { name: 'Material', value: 'Madera natural', type: 'text', isConfirmed: true },
    { name: 'Piezas', value: '25', type: 'text', isConfirmed: false },
  ];
  const gallery = [{ id: 'g1', name: 'Caja', url: '/assets/jenga/ficha/UON-KIT-01.MAIN.jpg', size: 400_000, dimensions: { width: 2000, height: 2000 } }];

  it('usa el producto abierto, sus campos confirmados y su galería', () => {
    const data = getProductEcosystemData('', readEcosystemSources(product, fields, gallery));
    expect(data).toMatchObject({ name: 'Make It Possible by Uonify', sku: 'UON-KIT-01', brand: 'Uonify', category: 'Juguetes' });
    expect(data.customAttributes.map(field => field.name)).toEqual(['Material']);
    expect(data.availableImages).toHaveLength(1);
    const suggested = buildSuggestedImage(data, TO.minW, TO.minH);
    expect(suggested).toMatchObject({ id: 'ecosystem-g1', isValid: true, dimensions: { width: 2000, height: 2000 }, format: 'image/jpeg' });
    expect(buildSuggestedImage(getProductEcosystemData('', readEcosystemSources(product, [], [])), TO.minW, TO.minH)).toBeNull();
  });

  it('una imagen de galería fuera de norma queda marcada con sus errores', () => {
    const small = [{ id: 'w', url: '/foto.webp', size: 3 * 1024 * 1024, dimensions: { width: 500, height: 200 } }];
    const suggested = buildSuggestedImage(getProductEcosystemData('', readEcosystemSources(product, [], small)), TO.minW, TO.minH);
    expect(suggested?.isValid).toBe(false);
    expect(suggested?.validationErrors).toEqual([
      'Formato no permitido. Use .jpg, .png o .bmp',
      'El archivo excede 2MB (actual: 3.0MB)',
      'Imagen muy pequeña. Mínimo: 970x300px (actual: 500x200px)',
    ]);
  });

  it('el generador simulado escribe titular y cuerpo con los datos del producto', () => {
    const copy = generateAplusCopy({ name: 'Make It Possible', brand: 'Uonify', category: 'Juguetes', custom_attributes: [{ name: 'Material', value: 'madera', type: 'text' }] }, () => 0);
    expect(copy.headline).toBe('Make It Possible de Uonify: Innovación que Transforma');
    expect(copy.bodyText).toContain('Con madera, este juguetes de Uonify');
    expect(generateAplusCopy({ name: 'X', description: 'd'.repeat(150) }, () => 0.99).bodyText).toBe(`${'d'.repeat(100)}...`);
  });
});
