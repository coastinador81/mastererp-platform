import { createPimStore } from '@/shared/pim';
import { SAMPLE_NAME, SAMPLE_SKU, SAMPLE_VERSION, sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import { seedCustomFields, seedSampleSlices } from '../model/sampleSeeding';

// Puerto de tests/sample-product.test.cjs: el producto de ejemplo «Make It Possible
// by Uonify», sus recursos reales y la siembra de sus porciones en la ficha.

interface FsLike {
  existsSync(path: string): boolean;
  statSync(path: string): { size: number };
  readFileSync(path: string): Uint8Array;
}

// node:fs sin tipos de Node en la app (las pruebas corren en Node).
const loadFs = (): Promise<FsLike> => import(/* @vite-ignore */ `node:${'fs'}`) as Promise<FsLike>;
// Las pruebas corren desde la raíz del proyecto: los recursos están en public/.
const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const fileOf = (url: string) => `${root}/public${decodeURIComponent(url)}`;

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 2; i < bytes.length;) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
    i += 2 + view.getUint16(i + 2);
  }
  return null;
}

type Media = { url: string; size: number; name?: string; id?: string; dimensions: { width: number; height: number } };
type Slices = {
  images: Media[];
  processedImages: Media[];
  aiImages: Media[];
  model3d: { selected3DModel: string; files: Array<{ key: string; url: string; size: number }> };
  video: { videos: Array<{ url: string; size: number; poster: string; title: string; chapters: Array<{ time: number; title: string; thumb: string }> }> };
  aplus: { content: { local: { data: { modules: Array<{ type: string; content: Record<string, unknown> }> } } } };
};

test('el producto de ejemplo se llama «Make It Possible by Uonify» y conserva su SKU', () => {
  const product = sampleProduct();
  expect(product.name).toBe('Make It Possible by Uonify: juego de 25 piezas de madera para apilar y crear 3 personajes');
  expect(product.name).toBe(SAMPLE_NAME);
  expect(product.sku).toBe('UON-KIT-01');
  expect((sampleSlices() as Slices).video.videos[0].title).toBe('Todo empieza jugando · Make It Possible by Uonify');
});

test('el ejemplo tiene todos los atributos, seis viñetas y campos personalizados confirmados', () => {
  const product = sampleProduct();
  const slices = sampleSlices() as Slices;
  expect(slices.images).toHaveLength(8);
  for (const key of ['name', 'sku', 'brand', 'category', 'price', 'cost', 'stock', 'description', 'keywords', 'image']) expect(String(product[key]).trim()).not.toBe('');
  expect(product.source).toBe('uonify');
  const bullets = product.bullets as string[];
  expect(bullets).toHaveLength(6);
  bullets.forEach(bullet => expect(bullet.length > 40 && bullet.length <= 250).toBe(true));
  expect(new TextEncoder().encode(String(product.keywords)).length).toBeLessThanOrEqual(250);
  expect(product.images).toBeUndefined();
  const fields = product.customFields as Array<{ isConfirmed: boolean; id: string; name: string }>;
  expect(fields.length).toBeGreaterThanOrEqual(8);
  expect(fields.every(field => field.isConfirmed && field.id && field.name)).toBe(true);
});

test('la ficha nunca usa «Jenga», marca registrada de otra empresa', () => {
  const product = sampleProduct();
  const slices = sampleSlices() as Slices;
  const aplusText = JSON.stringify(slices.aplus.content.local.data.modules.map(module => {
    const { backgroundImage: _b, image: _i, sections, ...rest } = module.content as Record<string, unknown> & { sections?: Array<{ headline: string; bodyText: string }> };
    return [rest, (sections || []).map(section => [section.headline, section.bodyText])];
  }));
  const fields = product.customFields as Array<{ value: unknown }>;
  const listing = [product.name, product.keywords, product.description, ...(product.bullets as string[]), ...fields.map(field => field.value), slices.video.videos[0].title, aplusText].join(' ');
  expect(listing).not.toMatch(/jenga/i);
});

test('cada imagen, modelo y vídeo del ejemplo existe con su peso y sus medidas', async () => {
  const fs = await loadFs();
  const product = sampleProduct();
  const slices = sampleSlices() as Slices;
  for (const image of [...slices.images, ...slices.processedImages, ...slices.aiImages]) {
    const file = fileOf(image.url);
    expect(fs.existsSync(file), image.url).toBe(true);
    expect(fs.statSync(file).size, image.name).toBe(image.size);
    expect(jpegSize(fs.readFileSync(file)), image.name).toEqual(image.dimensions);
  }
  expect(fs.existsSync(fileOf(String(product.image)))).toBe(true);
  for (const model of slices.model3d.files) expect(fs.statSync(fileOf(model.url)).size, model.key).toBe(model.size);
  expect(slices.model3d.selected3DModel).toBe(slices.model3d.files[0].url);
  const video = slices.video.videos[0];
  expect(fs.statSync(fileOf(video.url)).size).toBe(video.size);
  expect(fs.existsSync(fileOf(video.poster))).toBe(true);
  video.chapters.forEach(chapter => expect(fs.existsSync(fileOf(chapter.thumb)), chapter.title).toBe(true));
  expect(video.chapters.every((chapter, index, list) => index === 0 || chapter.time > list[index - 1].time)).toBe(true);
});

test('el A+ cumple las reglas: cinco módulos, límites de texto, sin precios ni enlaces, imágenes de menos de 2 MB', async () => {
  const fs = await loadFs();
  const modules = (sampleSlices() as Slices).aplus.content.local.data.modules;
  expect(modules.length).toBeLessThanOrEqual(5);
  const clean = (text: string) => expect(text).not.toMatch(/€|\$|(?<![\p{L}\p{N}])precios?(?![\p{L}\p{N}])|https?:\/\/|www\./iu);
  const image = (img: Media & { isValid: boolean }, minW: number, minH: number) => {
    expect(img.isValid && img.dimensions.width >= minW && img.dimensions.height >= minH).toBe(true);
    const file = fileOf(img.url);
    expect(fs.statSync(file).size).toBe(img.size);
    expect(img.size).toBeLessThan(2 * 1024 * 1024);
    expect(jpegSize(fs.readFileSync(file))).toEqual(img.dimensions);
  };
  for (const { type, content } of modules) {
    const c = content as Record<string, never>;
    if (type === 'text-overlay') {
      expect(String(c.headline).length).toBeLessThanOrEqual(70);
      expect(String(c.bodyText).length).toBeLessThanOrEqual(300);
      clean(`${c.headline} ${c.bodyText}`);
      image(c.backgroundImage, 970, 300);
    } else if (type === 'four-images') {
      const sections = c.sections as Array<{ headline: string; bodyText: string; image: Media & { isValid: boolean } }>;
      expect(String(c.generalHeadline).length).toBeLessThanOrEqual(160);
      expect(sections).toHaveLength(4);
      sections.forEach(section => {
        expect(section.headline.length <= 80 && section.bodyText.length <= 200).toBe(true);
        clean(`${section.headline} ${section.bodyText}`);
        image(section.image, 220, 220);
      });
    } else if (type === 'specifications') {
      const bullets = c.bulletPoints as string[];
      const blocks = c.blocks as Array<{ headline: string; subtitle: string; body: string }>;
      expect(bullets.length).toBeLessThanOrEqual(8);
      bullets.forEach(bullet => expect(bullet.length).toBeLessThanOrEqual(120));
      clean([c.mainHeadline, c.specificationHeadline, ...bullets, ...blocks.map(block => `${block.headline} ${block.subtitle} ${block.body}`)].join(' '));
      image(c.image, 300, 300);
    } else throw new Error(`módulo inesperado ${type}`);
  }
});

test('la ficha siembra el ejemplo una vez y solo en las porciones vacías', () => {
  const store = createPimStore({ storage: null });
  const scope = store.scope(SAMPLE_SKU);
  scope.set('gpsr', { manufacturer_contact: 'mío' });
  const sample = { id: SAMPLE_SKU, version: SAMPLE_VERSION, slices: sampleSlices() };
  expect(seedSampleSlices(scope, sample)).toBe(true);
  expect(scope.get<{ manufacturer_contact: string }>('gpsr').manufacturer_contact).toBe('mío');
  expect(scope.get<unknown[]>('images')).toHaveLength(8);
  expect(scope.get('sampleSeeded')).toBe(SAMPLE_VERSION);
  scope.set('images', []);
  expect(seedSampleSlices(scope, sample)).toBe(false);
  expect(scope.get<unknown[]>('images')).toHaveLength(0);
  // Una versión nueva siembra solo lo que siga vacío.
  expect(seedSampleSlices(scope, { ...sample, version: SAMPLE_VERSION + 1, slices: { ...sample.slices, extra: 1 } })).toBe(true);
  expect(scope.get('extra')).toBe(1);
  expect(scope.get<unknown[]>('images')).toHaveLength(0);
});

test('los campos personalizados iniciales se ponen una vez, los lea quien los lea', () => {
  const store = createPimStore({ storage: null });
  const scope = store.scope('A1');
  const defaults = vi.fn(() => [{ id: 'f1' }]);
  seedCustomFields(scope, null, 'A1', defaults);
  expect(defaults).not.toHaveBeenCalled();
  seedCustomFields(scope, { sku: 'A1', name: 'A' }, 'A1', defaults);
  seedCustomFields(scope, { sku: 'A1', name: 'A' }, 'A1', defaults);
  expect(defaults).toHaveBeenCalledTimes(1);
  expect(scope.get('customFields')).toEqual([{ id: 'f1' }]);
});
