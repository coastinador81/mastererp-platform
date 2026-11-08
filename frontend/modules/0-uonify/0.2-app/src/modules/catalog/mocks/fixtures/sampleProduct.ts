import type { CatalogProduct } from '../../model/types';
import { APLUS_MODULES } from './sampleAplus';
import { AI_IMAGES, GALLERY, MODELS, PROCESSED, SAMPLE_SKU, VIDEO, VIDEO_STUDIO, galleryUrl } from './sampleMedia';

/**
 * Producto de ejemplo de Uonify: «Make It Possible by Uonify» (SKU UON-KIT-01), el
 * juego de 25 piezas de madera (decisión del dueño: ese nombre va en el packaging).
 * Puerto de pim/sample-jenga.js del prototipo.
 *
 * - `sampleProduct()`: el registro del catálogo. La simulación lo añade una vez por
 *   sesión; si se elimina, no vuelve en esa sesión.
 * - `sampleSlices()`: el estado de cada pestaña en el almacén del PIM, con el mismo
 *   formato que escribe cada pestaña. La ficha lo siembra la primera vez que se abre
 *   (o se publica) y solo en las porciones vacías (ensureSampleSlices).
 *
 * Edad recomendada, EAN, país de origen y advertencias de seguridad quedan para el
 * dueño. GPSR lleva datos de Uonify de ejemplo (contactos y URL ficticios: hay que
 * sustituirlos antes de conectar Amazon). El nombre no usa «Jenga», marca registrada
 * de otra empresa. Precio, coste y stock son valores de ejemplo.
 *
 * VERSION: al subirla, la ficha siembra en las sesiones abiertas las porciones nuevas
 * que aún estén vacías (nunca pisa lo que la persona ya editó).
 */
export { SAMPLE_SKU };
export const SAMPLE_VERSION = 3;

export const SAMPLE_NAME = 'Make It Possible by Uonify: juego de 25 piezas de madera para apilar y crear 3 personajes';

const DESCRIPTION = [
  '<p><strong>Todo empieza jugando.</strong> Make It Possible by Uonify reúne 25 piezas de madera en azul y aqua, con detalles en blanco, para apilar, combinar y volver a imaginar. Con las mismas piezas levantas una torre en equilibrio y construyes los tres personajes de Uonify: Productos, ERP y Agentes.</p>',
  '<h3>Apila</h3>',
  '<p>Levanta la torre nivel a nivel. Cada turno pide calma y buen pulso: una sola pieza puede cambiarlo todo.</p>',
  '<h3>Combina</h3>',
  '<p>Desmonta la torre y reorganiza las formas. Con las mismas piezas aparecen Productos, ERP y Agentes.</p>',
  '<h3>Vuelve a imaginar</h3>',
  '<p>Cuando la torre cae, empieza otra idea. No hay una única manera de jugar: hay tantas como queráis inventar.</p>',
  '<h3>Qué incluye</h3>',
  '<ul><li>25 piezas de madera en azul y aqua, con detalles en blanco.</li><li>10 piezas para Productos, 6 para ERP y 9 para Agentes.</li><li>Caja de presentación con una bandeja de tres huecos, uno para cada personaje.</li></ul>',
].join('\n');

const BULLETS = [
  'Apila, combina y vuelve a imaginar: 25 piezas de madera para levantar una torre en equilibrio, desmontarla y crear algo nuevo con las mismas piezas.',
  'Tres personajes en una caja: con las mismas piezas construyes Productos, ERP y Agentes, los personajes de Uonify (10, 6 y 9 piezas).',
  'Madera en azul y aqua: la veta natural de la madera se combina con los colores de Uonify, con detalles en blanco, en formas redondeadas y fáciles de reconocer.',
  'Para jugar en compañía: turnos rápidos, tensión en cada pieza y risas cuando la torre cae. Después, a reconstruir.',
  'Cada pieza tiene su lugar: la bandeja de la caja guarda cada personaje en su hueco, para recoger el juego completo después de cada partida.',
  'Listo para regalar: caja de presentación azul con el nombre «Make It Possible», los tres personajes en la tapa y el lema «Apila. Combina. Vuelve a imaginar.»',
];

type FieldRow = [slug: string, name: string, type: string, value: string | boolean, options?: string[]];

const CUSTOM_FIELDS: FieldRow[] = [
  ['piezas', 'Número de piezas', 'number', '25'],
  ['personajes', 'Personajes', 'text', 'Productos (10 piezas), ERP (6 piezas) y Agentes (9 piezas)'],
  ['material', 'Material', 'text', 'Madera'],
  ['acabado', 'Acabado', 'select', 'Azul y aqua, con detalles en blanco', ['Azul y aqua, con detalles en blanco', 'Madera natural']],
  ['coleccion', 'Colección', 'text', 'Make It Possible'],
  ['variantes', 'Variantes', 'text', 'Azul y aqua (UON-KIT-01) · Madera natural (UON-KIT-02)'],
  ['contenido', 'Contenido de la caja', 'textarea', '25 piezas de madera y caja de presentación con una bandeja de tres huecos, uno para cada personaje.'],
  ['formas', 'Formas de juego', 'text', 'Apilar, combinar y reconstruir'],
  ['pilas', 'Requiere pilas', 'checkbox', false],
];

const PRODUCT: CatalogProduct = {
  name: SAMPLE_NAME,
  sku: SAMPLE_SKU,
  brand: 'Uonify',
  category: 'Juguetes y juegos › Juegos de construcción',
  price: '34.90',
  cost: '11.80',
  stock: '120',
  description: DESCRIPTION,
  keywords: 'juego de construccion madera piezas apilables torre equilibrio juego de mesa familiar bloques de madera juego de habilidad personajes juego creativo regalo azul aqua',
  bullets: BULLETS,
  // La galería vive en la porción 'images' (Imágenes); el registro solo lleva la
  // imagen principal para el catálogo y la cabecera.
  image: galleryUrl('MAIN'),
  customFields: CUSTOM_FIELDS.map(([slug, name, type, value, options = []]) => ({
    id: `field-jenga-${slug}`,
    name,
    type,
    value,
    options,
    isConfirmed: true,
  })),
  source: 'uonify',
  status: 'draft',
  sample: SAMPLE_SKU,
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Registro del catálogo del producto de ejemplo (copia nueva cada vez). */
export function sampleProduct(): CatalogProduct {
  return clone(PRODUCT);
}

/** Porciones del almacén del PIM que trae el ejemplo (copia nueva cada vez). */
export function sampleSlices(): Record<string, unknown> {
  return clone({
    images: GALLERY,
    processedImages: PROCESSED,
    aiImages: AI_IMAGES,
    model3d: {
      selected3DModel: MODELS[0].url,
      selectedKey: MODELS[0].key,
      isGenerating3D: false,
      generation3DProgress: 0,
      model3DCategory: 'floor',
      modelQualityInfo: null,
      uploadId: null,
      files: MODELS,
    },
    video: { selectedId: VIDEO.id, videos: [{ ...VIDEO, destination: 'listing', language: 'es' }] },
    videoStudio: VIDEO_STUDIO,
    // GPSR con datos de Uonify de ejemplo (ficticios, a petición del dueño).
    gpsr: {
      manufacturer_contact: 'seguridad@uonify.com',
      eu_responsible_address: 'responsable-ue@uonify.com',
      compliance_document_url: 'https://uonify.com/seguridad/UON-KIT-01/manual-de-seguridad.pdf',
      content_type: 'user_manual',
      content_language: 'es_ES',
      safety_attestation: true,
    },
    aplus: {
      content: {
        local: {
          data: { modules: APLUS_MODULES, brand: 'Uonify', hasUnsavedChanges: false, availableDocuments: [], selectedDocumentKey: '' },
          timestamp: Date.now(),
        },
      },
      crk: {},
    },
  });
}
