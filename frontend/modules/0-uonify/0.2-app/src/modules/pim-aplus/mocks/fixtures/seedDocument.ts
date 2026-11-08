import type { AmazonContentDocument, AmazonImage, AmazonImageTextBlock, AmazonText } from '../../model/amazonTypes';

/**
 * Contenido A+ publicado de ejemplo («Make It Possible» by Uonify) en el formato
 * de Amazon, con las imágenes del juego que sirve la web (public/assets/jenga).
 */
export const SEED_BRAND = 'Uonify';

const JPEG = 'image/jpeg';
export const SEED_IMAGES: Record<string, { asset: string; contentType: string }> = {
  'aplus-media/sc/uonify-banda-01.jpg': { asset: '/assets/jenga/aplus-amazon/banda-01.jpg', contentType: JPEG },
  'aplus-media/sc/uonify-apila.jpg': { asset: '/assets/jenga/ficha/UON-KIT-01.PT03.jpg', contentType: JPEG },
  'aplus-media/sc/uonify-transforma.jpg': { asset: '/assets/jenga/ficha/UON-KIT-01.PT04.jpg', contentType: JPEG },
  'aplus-media/sc/uonify-piezas.jpg': { asset: '/assets/jenga/ficha/UON-KIT-01.PT05.jpg', contentType: JPEG },
  'aplus-media/sc/uonify-detalle.jpg': { asset: '/assets/jenga/ficha/UON-KIT-01.PT06.jpg', contentType: JPEG },
  'aplus-media/sc/uonify-caja.jpg': { asset: '/assets/jenga/ficha/UON-KIT-01.PT01.jpg', contentType: JPEG },
};

const text = (value: string): AmazonText => ({ value });
const image = (uploadDestinationId: string, altText: string, width: number, height: number): AmazonImage => ({
  uploadDestinationId,
  altText,
  imageCropSpecification: { size: { width: { value: width, units: 'pixels' }, height: { value: height, units: 'pixels' } } },
});
const block = (id: string, alt: string, headline: string, body: string): AmazonImageTextBlock => ({
  image: image(id, alt, 220, 220),
  headline: text(headline),
  body: { textList: [text(body)] },
});

export function seedContentDocument(asin: string): AmazonContentDocument {
  return {
    name: asin,
    contentType: 'EBC',
    contentSubType: 'STANDARD',
    locale: 'es-ES',
    contentModuleList: [
      {
        contentModuleType: 'STANDARD_IMAGE_TEXT_OVERLAY',
        standardImageTextOverlay: {
          overlayColorType: 'DARK',
          block: {
            image: image('aplus-media/sc/uonify-banda-01.jpg', 'Dos personas empiezan una partida con las piezas de Uonify', 970, 300),
            headline: text('Make It Possible: todo empieza jugando.'),
            body: {
              textList: [text('Las mismas piezas. Más de una manera de crear. Veinticinco piezas de madera en azul y aqua, con detalles en blanco, para apilar, combinar y volver a imaginar en compañía.')],
            },
          },
        },
      },
      {
        contentModuleType: 'STANDARD_FOUR_IMAGE_TEXT',
        standardFourImageText: {
          headline: text('Una caja. Muchas maneras de jugar.'),
          block1: block('aplus-media/sc/uonify-apila.jpg', 'La torre de Uonify en tres pasos: prepara, apila y equilibra', 'Apila', 'Del equilibrio a la imaginación: levanta la torre nivel a nivel y encuentra tu propia forma.'),
          block2: block('aplus-media/sc/uonify-transforma.jpg', 'Los personajes Productos, ERP y Agentes montados con las piezas', 'Transforma', 'Mismas piezas, tres personajes. Desmonta, combina y vuelve a empezar.'),
          block3: block('aplus-media/sc/uonify-piezas.jpg', 'Las 25 piezas del juego ordenadas por forma', 'Qué incluye', '25 piezas de madera: 10 para Productos, 6 para ERP y 9 para Agentes.'),
          block4: block('aplus-media/sc/uonify-detalle.jpg', 'Detalle de tres piezas con la veta de la madera y el acabado de color', 'El detalle también cuenta', 'Madera natural, color y formas redondeadas pensadas para combinar.'),
        },
      },
      {
        contentModuleType: 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL',
        standardSingleImageSpecsDetail: {
          headline: text('Dentro de la caja'),
          image: image('aplus-media/sc/uonify-caja.jpg', 'La caja del juego abierta, con los tres personajes en su bandeja', 300, 300),
          descriptionHeadline: text('Tres personajes, un solo juego'),
          descriptionBlock1: {
            headline: text('Productos, ERP y Agentes'),
            body: { textList: [text('Cada personaje tiene su hueco en la bandeja, así el juego vuelve completo a la caja después de cada partida.')] },
          },
          specificationHeadline: text('Especificaciones'),
          specificationListBlock: {
            block: {
              textList: [
                '25 piezas de madera',
                'Azul y aqua, con detalles en blanco',
                'Personaje Productos: 10 piezas',
                'Personaje ERP: 6 piezas',
                'Personaje Agentes: 9 piezas',
                'Caja de presentación con bandeja de tres huecos',
                'No necesita pilas',
              ].map((value, index) => ({ position: index + 1, text: text(value) })),
            },
          },
        },
      },
    ],
  };
}
