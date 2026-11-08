import { SAMPLE_SKU, asset } from './sampleMedia';

/**
 * Contenido A+ del producto de ejemplo (puerto de pim/sample-jenga.js): cinco
 * módulos estándar (el máximo de A+ básico). Imágenes en JPEG de menos de 2 MB,
 * como exige Amazon; textos sin precios ni enlaces.
 */
const JPEG = 'image/jpeg';

const aplusImage = (id: string, path: string, width: number, height: number, size: number, altText: string) => ({
  id,
  url: asset(path),
  file: null,
  altText,
  dimensions: { width, height },
  size,
  format: JPEG,
  isValid: true,
  validationErrors: [] as string[],
});

const MODULE_TITLES: Record<string, string> = {
  'text-overlay': 'Superposición de texto oscuro e imagen estándar',
  specifications: 'Detalles de especificaciones y una sola imagen estándar',
  'four-images': 'Cuatro imágenes y texto estándares',
};

const aplusModule = (id: string, type: string, content: Record<string, unknown>) => ({
  id,
  type,
  title: MODULE_TITLES[type],
  content,
  isValid: true,
  validationErrors: [] as string[],
});

export const APLUS_MODULES = [
  aplusModule('jenga-aplus-apertura', 'text-overlay', {
    headline: 'Todo empieza jugando.',
    bodyText: 'Las mismas piezas. Más de una manera de crear. Veinticinco piezas de madera en azul y aqua, con detalles en blanco, para apilar, combinar y volver a imaginar en compañía.',
    backgroundImage: aplusImage('jenga-aplus-banda-01', 'jenga/aplus-amazon/banda-01.jpg', 1940, 648, 300322, 'Dos personas empiezan una partida con las piezas de Uonify'),
  }),
  aplusModule('jenga-aplus-turno', 'text-overlay', {
    headline: 'Tu turno.',
    bodyText: 'Una pieza puede cambiarlo todo. Y si la torre cae, esto también es jugar: a veces la mejor idea empieza al caer.',
    backgroundImage: aplusImage('jenga-aplus-banda-03', 'jenga/aplus-amazon/banda-03.jpg', 1940, 648, 296953, 'Un jugador coloca una pieza aqua con cuidado mientras su pareja contiene la respiración'),
  }),
  aplusModule('jenga-aplus-maneras', 'four-images', {
    generalHeadline: 'Una caja. Muchas maneras de jugar.',
    sections: [
      {
        headline: 'Apila',
        bodyText: 'Del equilibrio a la imaginación: levanta la torre nivel a nivel y encuentra tu propia forma.',
        image: aplusImage('jenga-aplus-apila', `jenga/ficha/${SAMPLE_SKU}.PT03.jpg`, 2000, 2000, 293160, 'La torre de Uonify en tres pasos: prepara, apila y equilibra'),
      },
      {
        headline: 'Transforma',
        bodyText: 'Mismas piezas, tres personajes. Desmonta, combina y vuelve a empezar.',
        image: aplusImage('jenga-aplus-transforma', `jenga/ficha/${SAMPLE_SKU}.PT04.jpg`, 2000, 2000, 310280, 'Los personajes Productos, ERP y Agentes montados con las piezas'),
      },
      {
        headline: 'Qué incluye',
        bodyText: '25 piezas de madera: 10 para Productos, 6 para ERP y 9 para Agentes.',
        image: aplusImage('jenga-aplus-piezas', `jenga/ficha/${SAMPLE_SKU}.PT05.jpg`, 2000, 2000, 264573, 'Las 25 piezas del juego ordenadas por forma'),
      },
      {
        headline: 'El detalle también cuenta',
        bodyText: 'Madera natural, color y formas redondeadas pensadas para combinar.',
        image: aplusImage('jenga-aplus-detalle', `jenga/ficha/${SAMPLE_SKU}.PT06.jpg`, 2000, 2000, 229892, 'Detalle de tres piezas con la veta de la madera y el acabado de color'),
      },
    ],
  }),
  aplusModule('jenga-aplus-otra-idea', 'text-overlay', {
    headline: 'Mismas piezas. Otra idea.',
    bodyText: 'Combina sus formas y descubre lo que podéis crear: de la torre a Productos, ERP y Agentes. Apila. Combina. Vuelve a imaginar.',
    backgroundImage: aplusImage('jenga-aplus-banda-07', 'jenga/aplus-amazon/banda-07.jpg', 1940, 648, 305933, 'Dos personas construyen un personaje de Uonify con las piezas sobre la mesa'),
  }),
  aplusModule('jenga-aplus-caja', 'specifications', {
    mainHeadline: 'Dentro de la caja',
    blocks: [
      {
        headline: 'Tres personajes, un solo juego',
        subtitle: 'Productos, ERP y Agentes',
        body: 'Cada personaje tiene su hueco en la bandeja, así el juego vuelve completo a la caja después de cada partida.',
      },
    ],
    specificationHeadline: 'Especificaciones',
    bulletPoints: [
      '25 piezas de madera',
      'Azul y aqua, con detalles en blanco',
      'Personaje Productos: 10 piezas',
      'Personaje ERP: 6 piezas',
      'Personaje Agentes: 9 piezas',
      'Caja de presentación con bandeja de tres huecos',
      'No necesita pilas',
    ],
    image: aplusImage('jenga-aplus-caja-abierta', `jenga/ficha/${SAMPLE_SKU}.PT01.jpg`, 1934, 1266, 507199, 'La caja del juego abierta, con los tres personajes en su bandeja'),
  }),
];
