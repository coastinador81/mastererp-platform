import type { ImageRef, Plan } from '../model/types';

/**
 * Guiones del producto de ejemplo (PROTO: pim/sample-jenga.js, VIDEO_STUDIO), para
 * comprobar que pasan la revisión. El módulo catalog siembra el ejemplo real.
 */
const frame = (id: string, path: string, width: number, height: number, source: ImageRef['source'] = 'upload'): ImageRef => ({
  id, url: `https://uonify.com/assets/${path}`, name: path.split('/').pop() || '', width, height, source,
});

const FRAMES = {
  tower: frame('jenga-pt02', 'jenga/galeria/UON-KIT-01.PT02.jpg', 1600, 1600),
  partida: frame('ai-jenga-la-partida', 'jenga/ficha/lifestyle-la-partida.jpg', 1254, 1254, 'ai-generated'),
  turno: frame('ai-jenga-tu-turno', 'jenga/ficha/lifestyle-tu-turno.jpg', 1672, 941, 'ai-generated'),
  compania: frame('ai-jenga-compania', 'jenga/ficha/lifestyle-compania.jpg', 1672, 941, 'ai-generated'),
};
const TAGLINE = 'Apila. Combina. Vuelve a imaginar.';

export const SAMPLE_PLANS: Record<'listing' | 'ads', Plan> = {
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
};
