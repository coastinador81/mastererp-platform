import type { PimProduct, PimTabKey, PublishData } from '@/shared/pim';

/**
 * Tipos del servicio Producto (catálogo, ficha y «Publicar»).
 * El producto guardado es un PimProduct (@/shared/pim) con los campos habituales
 * del prototipo: name, sku, brand, category, price, cost, stock, description,
 * keywords, bullets[], image, customFields[], source, status, sample?, createdAt.
 */
export type CatalogProduct = PimProduct & {
  brand?: string;
  image?: string;
  status?: string;
  source?: string;
  /** Id del producto de ejemplo del que sale (sus porciones se siembran al abrirlo). */
  sample?: string;
  createdAt?: number;
};

/** Canales activos de un producto en la cabecera: { Amazon: true }. */
export type ChannelStates = Record<string, boolean>;

/** Producto de ejemplo: porciones del almacén del PIM y su versión (GET /samples/:id). */
export interface SampleDefinition {
  id: string;
  version: number;
  slices: Record<string, unknown>;
}

/** Lo que muestra la URL del servicio Producto. */
export interface ProductRoute {
  /** SKU de la ficha abierta (null sin ficha o en «Nuevo Producto»). */
  sku: string | null;
  /** «Nuevo Producto» abierto. */
  isNew: boolean;
  tab: PimTabKey;
}

/** Un producto listo para el diálogo «Publicar». */
export interface PublishItem {
  sku: string;
  name: string;
  image: string;
  data: PublishData;
}

/** Petición de apertura del diálogo «Publicar». */
export interface PublishRequest {
  items: PublishItem[];
  /** Canales activos en alguno de los productos (se marcan al abrir). */
  preselect: string[];
}
