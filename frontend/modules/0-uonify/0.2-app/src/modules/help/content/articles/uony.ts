import type { ArticleSeed } from '../types';

/** Colección 2 · Uony (hablar con Uony, qué puede hacer y si algo falla). */
export const UONY: ArticleSeed[] = [
  {
    slug: 'hablar-con-uony',
    title: 'Cómo hablar con Uony',
    summary: 'Le pides a Uony lo que necesitas con tus palabras. Entiende el lenguaje natural; no hay que usar palabras exactas.',
    collection: 'uony',
    topic: 'conversación',
    order: 1,
    views: 0,
    keywords: ['uony', 'chat', 'conversación', 'escribir', 'voz', 'hablar', 'peticiones'],
    assistantNotes: ['Uony entiende el español natural; no hay listas de palabras.', 'No prometer la voz como disponible mientras no lo esté.'],
    body: `
## Cómo le hablo

Escribe en la caja lo que quieres conseguir, con tus palabras. Por ejemplo: «Prepara la ficha de este producto» o «Hazme un vídeo para la ficha». Uony entiende el lenguaje natural: no tienes que usar palabras exactas ni aprender comandos.

## Uony me pregunta

Cuando le falta algo para seguir, Uony te hace una pregunta sencilla, con opciones y la posibilidad de responder a tu manera. Solo pregunta lo que no puede resolver con lo que ya tiene.

## Mientras trabaja

El trabajo largo se hace en segundo plano. Puedes seguir conversando o cerrar; Uony te avisa cuando está.
`,
  },
  {
    slug: 'lo-que-uony-puede-hacer',
    title: 'Lo que Uony puede hacer por ti',
    summary: 'Uony prepara fichas, crea imágenes y vídeos, revisa lo que falta y te ayuda a publicar, siempre con tu visto bueno.',
    collection: 'uony',
    topic: 'funciones',
    order: 2,
    views: 0,
    keywords: ['uony', 'funciones', 'fichas', 'imágenes', 'vídeos', 'revisar', 'publicar'],
    assistantNotes: [],
    body: `
## Con tus productos

Uony prepara la ficha de un producto: reúne los datos, propone títulos y descripciones, revisa lo que falta y te deja decidir qué conservar.

## Con imágenes y vídeos

Con el Estudio, Uony crea imágenes y vídeos a partir de tus fotos o desde cero. Antes de crear cada pieza, te enseña su precio máximo y te pide tu OK. Consulta [Crear una imagen o un vídeo](/ayuda/crear-imagen-o-video).

## Con tus canales

Uony prepara la ficha para tu cuenta de vendedor de Amazon y te enseña la vista previa exacta antes de enviarla.

## Tú decides

Uony propone; tú revisas y apruebas. Nada se publica ni se gasta sin tu visto bueno.
`,
  },
  {
    slug: 'si-algo-falla',
    title: 'Si algo falla',
    summary: 'Si algo no sale, Uony te lo explica en palabras sencillas y te propone otra salida. Nunca te deja bloqueado.',
    collection: 'uony',
    topic: 'errores',
    order: 3,
    views: 0,
    keywords: ['error', 'fallo', 'no funciona', 'reintentar', 'bloqueado', 'problema'],
    assistantNotes: ['Nunca culpar a «Google» ni mostrar códigos técnicos.', 'El cliente nunca ve un callejón sin salida.'],
    body: `
## Qué pasa si algo no sale

Uony te explica qué ha ocurrido con palabras sencillas y te propone un siguiente paso o una versión ajustada. No verás mensajes técnicos ni te quedarás sin poder continuar.

## Y si era algo que iba a costar

Si una imagen o un vídeo no se llega a crear, Uony te lo dice y te propone rehacerlo. Una versión ajustada vuelve a pedir tu visto bueno antes de gastar.

## Puedo reintentar

Sí. Cuando algo falla, puedes pedir a Uony que lo intente de nuevo. Si hay un coste, lo verás antes.
`,
  },
];
