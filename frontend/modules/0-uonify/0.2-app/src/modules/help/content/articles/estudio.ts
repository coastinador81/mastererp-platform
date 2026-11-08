import type { ArticleSeed } from '../types';

/**
 * Colección 5 · Estudio (crear piezas, Elementos, precio y publicar).
 * La colección se publica cuando el Estudio esté instalado y probado; los textos van
 * preparados.
 */
export const ESTUDIO: ArticleSeed[] = [
  {
    slug: 'crear-imagen-o-video',
    title: 'Crear una imagen o un vídeo',
    summary: 'Le pides a Uony la imagen o el vídeo con tus palabras, con tus fotos o desde cero. Ves el plan y el precio antes de crear.',
    collection: 'estudio',
    topic: 'crear',
    order: 1,
    views: 0,
    keywords: ['estudio', 'imagen', 'vídeo', 'crear', 'fotos', 'desde cero', 'plan', 'formato', 'veo', 'nano banana'],
    assistantNotes: ['Motores de Google como etiqueta: Nano Banana (imágenes), Veo (vídeo), voces de Google y Lyria. Nunca el id técnico.'],
    body: `
## Cómo lo pido

Dile a Uony qué quieres: «Hazme la imagen principal con fondo blanco» o «Un vídeo de 24 s para la ficha». Si tienes fotos, Uony parte de ellas; si no, imagina la escena contigo.

## El plan y el precio

Uony te enseña un plan —el formato, la duración, las escenas— y su precio máximo en euros. No se crea nada hasta que le das tu visto bueno.

## Con qué se crea

Las imágenes se crean con Nano Banana y los vídeos con Veo, la tecnología de Google, en tu propio proyecto. Si quieres, Uony añade voz con las voces de Google o música con Lyria.

## Dónde queda

Cada pieza queda en tu biblioteca del Estudio. Desde ahí la descargas o le pides a Uony que la lleve a tu ficha.
`,
  },
  {
    slug: 'los-elementos',
    title: 'Los Elementos',
    summary: 'Guarda un personaje, un producto, un lugar o un estilo y reutilízalo para que todo salga coherente.',
    collection: 'estudio',
    topic: 'elementos',
    order: 2,
    views: 0,
    keywords: ['elementos', 'personaje', 'producto', 'lugar', 'estilo', 'reutilizar', 'coherencia', 'voz'],
    assistantNotes: ['Una persona real necesita su permiso.', 'Solo los personajes pueden llevar voz.'],
    body: `
## Qué son

Los Elementos son piezas que guardas para reutilizar: un personaje, un producto u objeto, un lugar o un estilo. Así tu producto o tu personaje salen siempre igual en cada imagen y cada vídeo.

## Cómo los uso

Los creas con fotos o generándolos, y les pones nombre. Luego los nombras a Uony: «Ana con la lámpara en el salón». Uony los reconoce por su nombre.

## Personas reales

Si un Elemento es una persona real, hace falta su permiso. Los personajes pueden llevar voz, si quieres.
`,
  },
  {
    slug: 'precio-maximo-y-visto-bueno',
    title: 'El precio máximo y tu visto bueno',
    summary: 'Antes de crear, ves el precio máximo en euros y das tu OK. Cada gasto pide su visto bueno.',
    collection: 'estudio',
    topic: 'precio',
    order: 3,
    views: 0,
    keywords: ['precio', 'máximo', 'euros', 'ok', 'visto bueno', 'gasto', 'lote'],
    assistantNotes: [],
    body: `
## Cómo apruebo un gasto

Antes de crear una pieza, Uony te enseña una tarjeta con lo que va a crear, su precio máximo en euros y quién lo paga. Pulsas **Crear** o respondes «sí».

## Un lote de piezas

Si pides varias piezas a la vez, Uony te enseña su precio máximo total y lo apruebas de una vez.

## Cada cambio

Cada «rehazlo» vuelve a pedir tu visto bueno. Nunca se gasta sin tu OK. Si una pieza no se llega a crear, Uony te lo dice y te propone una versión ajustada antes de volver a gastar.
`,
  },
  {
    slug: 'versiones-biblioteca-y-publicar',
    title: 'Versiones, biblioteca y publicar',
    summary: 'Comparas versiones y eliges una; todas tus piezas quedan en la biblioteca; y Uony las lleva a tu ficha con tu aprobación.',
    collection: 'estudio',
    topic: 'biblioteca',
    order: 4,
    views: 0,
    keywords: ['versiones', 'comparar', 'biblioteca', 'descargar', 'publicar', 'ficha'],
    assistantNotes: ['El resultado real en la cuenta de vendedor de Amazon se describe cuando esté comprobado.'],
    body: `
## Versiones

Al cambiar una escena, Uony te enseña la versión anterior y la nueva para que compares y elijas. La que no eliges se guarda en tu biblioteca, por si la quieres después.

## Tu biblioteca

Todas tus piezas quedan en la biblioteca del Estudio, organizadas por proyecto. Desde ahí las ves, las descargas o le pides a Uony que las use en una ficha o un anuncio.

## Publicar con tu aprobación

Pide a Uony que lleve una pieza a tu ficha o a tu contenido. Antes de publicar, te enseña exactamente lo que se va a enviar y tú lo apruebas.
`,
  },
];
