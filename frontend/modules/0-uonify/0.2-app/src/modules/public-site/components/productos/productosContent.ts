/**
 * Contenido de la página Productos (#view-producto, productos.js y galeria-imagenes.js).
 * El producto de ejemplo es «Make It Possible by Uonify» (decisión del dueño).
 */
export const SAMPLE_PRODUCT_NAME = 'Make It Possible by Uonify';

/** Los nueve servicios del carrusel y del directorio final. */
export const FAMILY: ReadonlyArray<{ id: string; label: string; icon: string }> = [
  { id: 'catalogo', label: 'Productos', icon: 'catalogo' },
  { id: 'erp', label: 'ERP', icon: 'erp' },
  { id: 'analitica', label: 'Analítica', icon: 'analitica' },
  { id: 'auditoria', label: 'Captura y auditoría', icon: 'auditoria' },
  { id: 'agentes', label: 'Agentes', icon: 'hive' },
  { id: 'academy', label: 'Academy', icon: 'academy' },
  { id: 'logistica', label: 'Logística', icon: 'logistica' },
  { id: 'fabrica', label: 'Fábrica y proveedores', icon: 'fabrica' },
  { id: 'nexus', label: 'Nexus', icon: 'nexus' },
];

export const SECTION_NAV: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'catalogo', label: 'Descubre Productos' },
  { id: 'inteligencia', label: 'Trabaja con Uony' },
  { id: 'herramientas', label: 'El universo Uonify' },
  { id: 'empezar', label: 'Empieza y crece' },
  { id: 'explorar', label: 'Todas las herramientas' },
];

export interface GalleryImage {
  src: string;
  thumb: string;
  thumbWidth: number;
  thumbHeight: number;
  size: number;
  title: string;
  description: string;
  alt: string;
  /** Texto corto de la miniatura y su nombre accesible. */
  short: string;
  label: string;
}

const G = '/assets/galeria-v57/';

export const GALLERY_IMAGES: readonly GalleryImage[] = [
  { src: `${G}01-hero-packaging-abierto.png`, thumb: `${G}01-hero-packaging-abierto-thumb.png`, thumbWidth: 256, thumbHeight: 168, size: 1934, title: 'El juego completo.', description: 'Una caja. Las mismas piezas, muchas maneras de jugar.', alt: 'La caja de Uonify cerrada junto a la misma caja abierta, con los personajes Productos, ERP y Agentes organizados dentro', short: 'El juego', label: 'el juego completo' },
  { src: `${G}02-torre-exacta.png`, thumb: `${G}02-torre-exacta-thumb.png`, thumbWidth: 384, thumbHeight: 384, size: 1600, title: 'El juego apilado.', description: 'Las piezas reales de Uonify construyen una torre lista para jugar.', alt: 'Torre construida únicamente con las piezas originales azules, aqua y blancas de Uonify', short: 'La torre', label: 'el juego apilado' },
  { src: `${G}03-apila-exacta.png`, thumb: `${G}03-apila-exacta-thumb.png`, thumbWidth: 384, thumbHeight: 384, size: 3000, title: 'Del equilibrio a la imaginación.', description: 'Prepara la base, añade piezas y encuentra nuevas formas.', alt: 'Tres construcciones realizadas con las piezas originales de Uonify, desde una base sencilla hasta una composición más alta', short: 'Apila', label: 'apila y construye' },
  { src: `${G}04-transforma-exacta.png`, thumb: `${G}04-transforma-exacta-thumb.png`, thumbWidth: 384, thumbHeight: 384, size: 3000, title: 'Mismas piezas. Tres personajes.', description: 'Desmonta, combina y vuelve a imaginar.', alt: 'Los personajes originales de Productos, ERP y Agentes formados con las piezas exactas del juego Uonify', short: 'Transforma', label: 'combina y transforma' },
  { src: `${G}05-piezas-exactas.png`, thumb: `${G}05-piezas-exactas-thumb.png`, thumbWidth: 384, thumbHeight: 384, size: 3000, title: 'Cada pieza tiene su lugar.', description: 'Las 25 piezas originales de los tres personajes, una a una.', alt: 'Vista cenital de las 25 piezas originales separadas y ordenadas, con cuerpos, ojos, sonrisas y barras', short: 'Qué incluye', label: 'contenido del juego' },
  { src: `${G}06-detalles-exactos.png`, thumb: `${G}06-detalles-exactos-thumb.png`, thumbWidth: 384, thumbHeight: 384, size: 3000, title: 'El detalle también cuenta.', description: 'Mira de cerca la madera, el color y las formas.', alt: 'Primer plano de piezas originales azules y aqua con los cantos y la veta de la madera visibles', short: 'Los detalles', label: 'materiales y detalles' },
  { src: `${G}07-packaging-completo.png`, thumb: `${G}07-packaging-completo-thumb.png`, thumbWidth: 384, thumbHeight: 279, size: 2200, title: 'Todo explicado en la caja.', description: 'El reverso comercial reúne las formas de juego y el contenido del producto.', alt: 'Reverso azul del packaging de Uonify con instrucciones visuales, contenido del juego y código de barras', short: 'Packaging', label: 'packaging completo' },
];

/** Tonos del ejemplo de descripción (03 / COMUNICA). */
export const TONE_DESCRIPTIONS = {
  cercano: 'Reúne las piezas, construye un personaje y vuelve a empezar. El juego de Uonify da forma a nuevas ideas con madera, azul y aqua.',
  directo: 'Juego de construcción de madera con piezas geométricas azules y aqua. Consulta el conjunto, explóralo en 3D y reúne su información en una ficha.',
} as const;

export type Tone = keyof typeof TONE_DESCRIPTIONS;

export interface AiScene { request: string; answer: string; title: readonly [string, string]; state: string }

/** Escenas de «Imagina lo que puedes pedir» (Uony responde). */
export const AI_SCENES = {
  revisar: {
    request: `Revisa la ficha de ${SAMPLE_PRODUCT_NAME} y dime qué falta antes de publicarla.`,
    answer: 'La ficha reúne la información principal y las imágenes. Falta confirmar las dimensiones. Te dejo ese punto señalado para que puedas revisarlo.',
    title: ['Una revisión clara.', 'El siguiente paso, también.'],
    state: 'Dimensiones por confirmar',
  },
  contenido: {
    request: `Prepara una descripción cercana para ${SAMPLE_PRODUCT_NAME} a partir de su ficha.`,
    answer: 'Aquí tienes una propuesta: «Pequeñas piezas. Grandes ideas». Puedes revisar el texto y ajustarlo antes de incorporarlo a la ficha.',
    title: ['Una primera versión', 'para seguir creando.'],
    state: 'Borrador para revisar',
  },
  organizar: {
    request: 'Ayúdame a organizar lo que falta para preparar este producto para sus canales.',
    answer: 'Podemos empezar por confirmar las dimensiones, revisar el contenido y elegir las imágenes. Después, tendrás una base más clara para preparar cada canal.',
    title: ['De una petición', 'a un recorrido con sentido.'],
    state: 'Tres pasos, un mismo producto',
  },
} as const satisfies Record<string, AiScene>;

export type AiSceneKey = keyof typeof AI_SCENES;

export const AI_SCENE_BUTTONS: ReadonlyArray<{ key: AiSceneKey; number: string; title: string; copy: string }> = [
  { key: 'revisar', number: '01', title: 'Revisa un producto', copy: 'Entiende lo que está y lo que falta.' },
  { key: 'contenido', number: '02', title: 'Prepara su contenido', copy: 'Convierte una idea en un borrador.' },
  { key: 'organizar', number: '03', title: 'Organiza el siguiente paso', copy: 'Trabaja con el contexto del catálogo.' },
];
