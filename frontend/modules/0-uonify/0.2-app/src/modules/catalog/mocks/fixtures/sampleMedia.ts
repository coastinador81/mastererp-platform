/**
 * Producto de ejemplo «Make It Possible by Uonify» (SKU UON-KIT-01): galería,
 * modelos 3D, vídeo y guiones de vídeo con IA. Puerto de pim/sample-jenga.js del
 * prototipo, con el mismo formato que escribe cada pestaña en el almacén del PIM.
 *
 * Datos reales de los recursos (medidas, pesos de archivo, triángulos, texturas,
 * duración y escenas del vídeo, que salen de su montaje en Blender). Los archivos
 * están en public/assets (se sirven como /assets/…).
 */
export const SAMPLE_SKU = 'UON-KIT-01';

/** Ruta pública de un recurso del prototipo copiado en public/assets. */
export const asset = (path: string): string => `/assets/${path}`;

const JPEG = 'image/jpeg';

/* ---------------------------------------------------------- galería */
// Fotos y renders del juego, con el nombre de archivo que pide Amazon
// (SKU.MAIN / SKU.PT01…), en JPEG de 2000 px como máximo.
export const galleryUrl = (slot: string): string => asset(`jenga/ficha/${SAMPLE_SKU}.${slot}.jpg`);

const GALLERY_ROWS: Array<[string, number, number, number]> = [
  ['MAIN', 351930, 2000, 2000],
  ['PT01', 507199, 1934, 1266],
  ['PT02', 195334, 1600, 1600],
  ['PT03', 293160, 2000, 2000],
  ['PT04', 310280, 2000, 2000],
  ['PT05', 264573, 2000, 2000],
  ['PT06', 229892, 2000, 2000],
  ['PT07', 275084, 2000, 1454],
];

export const GALLERY = GALLERY_ROWS.map(([slot, size, width, height]) => ({
  id: `jenga-${slot.toLowerCase()}`,
  url: galleryUrl(slot),
  name: `${SAMPLE_SKU}.${slot}.jpg`,
  size,
  type: JPEG,
  source: 'upload',
  status: 'pending',
  dimensions: { width, height },
  originalDimensions: null,
  processedDimensions: null,
}));

// «Redimensionar» a 1500 × 1500 sobre blanco, como hace la pestaña Imágenes.
const PROCESSED_ROWS: Array<[string, number, { width: number; height: number }]> = [
  ['PT01', 280790, { width: 1934, height: 1266 }],
  ['PT07', 156640, { width: 2000, height: 1454 }],
];

export const PROCESSED = PROCESSED_ROWS.map(([slot, size, originalDimensions]) => ({
  id: `processed-jenga-${slot.toLowerCase()}`,
  url: asset(`jenga/ficha/${SAMPLE_SKU}.${slot}.1500.jpg`),
  name: `Processed ${SAMPLE_SKU}.${slot}.jpg`,
  size,
  type: JPEG,
  source: 'upload',
  status: 'processed',
  dimensions: { width: 1500, height: 1500 },
  originalDimensions,
}));

// Escenas de estilo de vida creadas con IA para la campaña del juego.
const AI_ROWS: Array<[string, number, number, number]> = [
  ['la-partida', 394533, 1254, 1254],
  ['crea-en-compania', 496439, 1254, 1254],
  ['tu-turno', 422204, 1672, 941],
];

export const AI_IMAGES = AI_ROWS.map(([slug, size, width, height]) => ({
  id: `ai-jenga-${slug}`,
  url: asset(`jenga/ficha/lifestyle-${slug}.jpg`),
  name: `lifestyle-${slug}.jpg`,
  size,
  type: JPEG,
  source: 'ai-generated',
  status: 'generated',
  style: 'lifestyle',
  dimensions: { width, height },
}));

/* --------------------------------------------------------------- 3D */
// Modelos glTF-Binary del juego (Blender, materiales PBR). Triángulos y
// texturas medidos en cada archivo.
const MODEL_ROWS = [
  { key: `modelos/${SAMPLE_SKU}/torre-25-piezas.glb`, path: 'jenga/conjunto-torre-v62.glb', size: 2140424, polygons: 9664, texture: '1024x1024' },
  { key: `modelos/${SAMPLE_SKU}/tres-personajes.glb`, path: 'jenga/juego-completo.glb', size: 1916372, polygons: 9664, texture: '1024x1024' },
  { key: `modelos/${SAMPLE_SKU}/caja-presentacion.glb`, path: 'packaging-uonify-v56/packaging-refined.glb', size: 17501164, polygons: 1212, texture: '3840x2640' },
];

export const MODELS = MODEL_ROWS.map(model => ({
  key: model.key,
  url: asset(model.path),
  size: model.size,
  type: 'model/gltf-binary',
  local: true,
  metadata: {
    polygons: model.polygons,
    texture_resolution: model.texture,
    format: 'GLB',
    compression: 'Sin compresión',
    file_size: model.size,
  },
}));

/* ------------------------------------------------------------ vídeo */
// Montaje de 1920 × 1080 a 30 fps: cinco escenas de 6 s con fundidos de 0,8 s
// y música original. Cada escena empieza cuando termina su fundido.
const SCENES: Array<[number, string, string]> = [
  [0, '01-apertura', 'Todo empieza jugando.'],
  [6, '02-construccion', 'Juntos, pieza a pieza.'],
  [11.2, '03-tension', 'Una pieza puede cambiarlo todo.'],
  [16.4, '04-caida', '¡Ups! Esto también es jugar.'],
  [21.6, '05-reconstruccion', 'Mismas piezas. Otra idea.'],
];

export const VIDEO = {
  id: 'jenga-video-campana',
  name: 'uonify-juego-de-piezas.mp4',
  url: asset('video-uonify-v63/uonify-juego-propuesta-v63.mp4'),
  poster: asset('video-uonify-v63/portada.jpg'),
  size: 28411446,
  type: 'video/mp4',
  duration: 26.8,
  width: 1920,
  height: 1080,
  codecs: 'H.264 · AAC',
  title: 'Todo empieza jugando · Make It Possible by Uonify',
  source: 'upload',
  chapters: SCENES.map(([time, slug, title]) => ({ time, title, thumb: asset(`video-uonify-v63/escenas/${slug}.jpg`) })),
};

/* ------------------------------------------------ guion de vídeo con IA */
// Pestaña Vídeo › Crear con IA: guiones listos para generar (aún sin generar). Cada
// plano parte de una foto de la ficha sin rótulos, porque la IA no reproduce bien los
// textos; en las escenas con personas solo hay adultos (Veo no genera niños en la UE).
const shotImage = (id: string, url: string, name: string, width: number, height: number, source = 'upload') => ({
  id,
  url,
  name,
  width,
  height,
  source,
});

const FRAMES = {
  tower: shotImage('jenga-pt02', galleryUrl('PT02'), `${SAMPLE_SKU}.PT02.jpg`, 1600, 1600),
  partida: shotImage('ai-jenga-la-partida', asset('jenga/ficha/lifestyle-la-partida.jpg'), 'lifestyle-la-partida.jpg', 1254, 1254, 'ai-generated'),
  turno: shotImage('ai-jenga-tu-turno', asset('jenga/ficha/lifestyle-tu-turno.jpg'), 'lifestyle-tu-turno.jpg', 1672, 941, 'ai-generated'),
  compania: shotImage('ai-jenga-crea-en-compania', asset('jenga/ficha/lifestyle-crea-en-compania.jpg'), 'lifestyle-crea-en-compania.jpg', 1254, 1254, 'ai-generated'),
};

export const TAGLINE = 'Apila. Combina. Vuelve a imaginar.';

export const VIDEO_STUDIO = {
  destination: 'listing',
  format: '16:9',
  audio: true,
  project: null,
  plans: {
    listing: {
      origin: 'ficha',
      destination: 'listing',
      shots: [
        { id: 'shot-1', image: FRAMES.tower, camera: 'orbit', action: 'La torre de 25 piezas de madera gira despacio sobre un fondo oscuro, con una luz lateral que hace brillar el azul y el aqua.', text: '25 piezas. Tres personajes.' },
        { id: 'shot-2', image: FRAMES.partida, camera: 'push_in', action: 'Dos adultos apilan piezas por turnos sobre una mesa de madera; la torre azul y aqua crece en equilibrio.', text: 'Apila por turnos, en equilibrio.' },
        { id: 'shot-3', image: FRAMES.turno, camera: 'static', action: 'Una pieza se desliza, la torre tiembla y cae sobre la mesa entre risas.', text: 'Cuando cae, empieza otra idea.' },
        { id: 'shot-4', image: FRAMES.compania, camera: 'pedestal', action: 'Con las mismas piezas, los dos forman sobre la mesa los tres personajes de Uonify.', text: 'Mismas piezas, otra forma de jugar.' },
      ],
      closing: { tagline: TAGLINE },
    },
    ads: {
      origin: 'ficha',
      destination: 'ads',
      shots: [
        { id: 'shot-1', image: FRAMES.turno, camera: 'push_in', action: 'Una pieza se desliza y la torre de madera tiembla sobre la mesa mientras dos adultos contienen la respiración.', text: 'Una pieza lo cambia todo.' },
        { id: 'shot-2', image: FRAMES.compania, camera: 'orbit', action: 'Los tres personajes de madera, ya formados sobre la mesa; la cámara los rodea despacio.', text: '25 piezas, tres personajes.' },
      ],
      closing: { tagline: TAGLINE },
    },
  },
};
