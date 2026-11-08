import type {
  CatalogImage,
  DerivedImages,
  ImageItem,
  ImageLists,
  ImageSlices,
  ImagesSnapshot,
  ProductInfo,
} from './types';

/**
 * Listas por producto (prototipo: pim/imagenes.js, «listas por producto»).
 *
 * Porción 'images' = allImages del original: subidas, scrapeadas, del producto,
 * del catálogo de Amazon, generadas por IA y procesadas, en ese orden. Es lo que
 * leen 3D, A+ y el guardado. 'processedImages' y 'aiImages' guardan sus grupos.
 * Todo es puro: el entorno (producto, catálogo, eliminadas, blobs vivos) llega
 * como parámetro.
 */

export interface ListsEnv {
  /** Producto guardado (null en «Nuevo Producto»). */
  info: ProductInfo | null;
  /** Imágenes del catálogo de Amazon del producto, si se han cargado. */
  catalog?: CatalogImage[];
  /** URLs eliminadas de las imágenes del producto (porción 'deletedImageUrls'). */
  deleted: ReadonlySet<string>;
  /** Una URL blob: solo vale si se creó en esta página (tras recargar ya no existe). */
  isAlive: (url: unknown) => boolean;
}

export const asArray = <T = unknown>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Copia sin `file` (nunca se guarda el File en el almacén). */
export function stripFile(image: ImageItem): ImageItem {
  const { file: _file, ...rest } = image;
  return rest;
}

const isImage = (value: unknown): value is ImageItem =>
  Boolean(value) && typeof value === 'object' && Boolean((value as ImageItem).url);

/** Imágenes que se rehacen a partir del producto (no se guardan como propias). */
export const isDerived = (item: Pick<ImageItem, 'id'> | null | undefined): boolean =>
  /^(product-|amazon-catalog-)/.test(String(item?.id ?? ''));

const urlOf = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const url = (entry as { url?: unknown }).url;
    return typeof url === 'string' ? url : undefined;
  }
  return undefined;
};

/**
 * ADD-02: Auditoría IA añade {id, url, file: null, source: 'scraped'} sin nombre ni
 * estado. Se muestran como «Scrapeada» con nombre scraped-N.jpg.
 */
export function normalizeScraped(item: ImageItem, index: number): ImageItem {
  const source = !item.source || item.source === 'scraped' ? 'scrape' : item.source;
  if (item.id && item.name && item.status && source === item.source) return item;
  return {
    ...item,
    id: item.id || `scraped-audit-${index}-${String(item.url).length}`,
    name: item.name || `scraped-${index + 1}.jpg`,
    source,
    status: item.status || 'pending',
  };
}

/** Separa lo guardado en subidas, scrapeadas, procesadas e IA. */
export function loadLists(slices: ImageSlices, env: ListsEnv): ImageLists {
  const alive = (item: ImageItem) => env.isAlive(item.url);
  const processed = asArray(slices.processedImages).filter(isImage).filter(alive);
  const ai = asArray(slices.aiImages).filter(isImage).filter(alive);
  const own = new Set([...processed, ...ai].map(item => item.id));
  const productUrls = new Set(asArray(env.info?.images).map(urlOf));
  const uploaded: ImageItem[] = [];
  const scraped: ImageItem[] = [];
  asArray(slices.images).forEach(raw => {
    // ADD-02 / IMG-41: Auditoría IA siembra la galería con product.images (URLs sueltas).
    // Siguen siendo imágenes del producto: derivedOf las rehace como «Product Image N».
    if (typeof raw === 'string' || !isImage(raw)) return;
    const item = raw;
    if (!alive(item) || isDerived(item) || own.has(item.id)) return;
    if (!item.source && productUrls.has(item.url)) return;
    if (item.status === 'processed' || item.source === 'ai-generated') return;
    if (item.source === 'upload') uploaded.push(item);
    else scraped.push(item);
  });
  return { uploaded, scraped: scraped.map(normalizeScraped), processed, ai };
}

/** Imágenes del producto (selectedProductData.images) y del catálogo de Amazon. */
export function derivedOf(lists: ImageLists, env: ListsEnv): DerivedImages {
  const { info, deleted } = env;
  if (!info) return { productImages: [], amazonImages: [] };
  const taken = new Set([...lists.uploaded, ...lists.scraped, ...lists.ai, ...lists.processed].map(item => item.url));
  const amazonImages: ImageItem[] = info.asin
    ? asArray<CatalogImage | null>(env.catalog)
      .map((img, index): ImageItem => ({
        id: `amazon-catalog-${info.id}-${index}`,
        url: img?.link ?? '',
        name: `Amazon ${String(img?.variant)} Image`,
        source: 'amazon',
        status: 'ready',
        dimensions: { width: img?.width, height: img?.height },
      }))
      .filter(img => img.url && !deleted.has(img.url))
    : [];
  amazonImages.forEach(img => taken.add(img.url));
  const productImages: ImageItem[] = [];
  info.images.forEach((entry, index) => {
    const url = urlOf(entry);
    if (!url || deleted.has(url) || taken.has(url) || !env.isAlive(url)) return;
    taken.add(url);
    productImages.push({ id: `product-${info.id}-${index}`, url, name: `Product Image ${index + 1}`, source: 'amazon', status: 'ready' });
  });
  return { productImages, amazonImages };
}

export const allImagesOf = (lists: ImageLists, derived: DerivedImages): ImageItem[] => [
  ...lists.uploaded,
  ...lists.scraped,
  ...derived.productImages,
  ...derived.amazonImages,
  ...lists.ai,
  ...lists.processed,
];

/** Lo que se escribe en el almacén tras cada cambio (saveLists del prototipo). */
export function listsToSlices(lists: ImageLists, env: ListsEnv) {
  return {
    processedImages: lists.processed.map(stripFile),
    aiImages: lists.ai.map(stripFile),
    images: allImagesOf(lists, derivedOf(lists, env)).map(stripFile),
  };
}

/** Estado para pintar: listas, derivadas, todas y la selección válida. */
export function buildSnapshot(slices: ImageSlices, env: ListsEnv, selection: readonly string[]): ImagesSnapshot {
  const lists = loadLists(slices, env);
  const derived = derivedOf(lists, env);
  const all = allImagesOf(lists, derived);
  const ids = new Set(all.map(item => item.id));
  return { lists, derived, all, selection: selection.filter(id => ids.has(id)) };
}

/** Recuento de la cabecera «Media» (totalImages del original: no cuenta las de IA). */
export function headTotal({ lists, derived }: Pick<ImagesSnapshot, 'lists' | 'derived'>): number {
  return lists.uploaded.length + lists.scraped.length + derived.productImages.length + lists.processed.length + derived.amazonImages.length;
}

/** Recuento de «Galería de Imágenes (N)»: subidas, scrapeadas, del producto y Amazon. */
export function galleryTotal({ lists, derived }: Pick<ImagesSnapshot, 'lists' | 'derived'>): number {
  return lists.uploaded.length + lists.scraped.length + derived.amazonImages.length + derived.productImages.length;
}

/** Lo que la pestaña necesita del producto guardado (null si no hay). */
export function productInfoOf(product: Record<string, unknown> | null | undefined, key: string): ProductInfo | null {
  if (!product) return null;
  const id = product.id;
  return {
    id: id === undefined || id === null ? key : String(id),
    images: asArray(product.images),
    asin: typeof product.asin === 'string' && product.asin ? product.asin : null,
    source: product.source,
    image: typeof product.image === 'string' && product.image ? product.image : null,
  };
}
