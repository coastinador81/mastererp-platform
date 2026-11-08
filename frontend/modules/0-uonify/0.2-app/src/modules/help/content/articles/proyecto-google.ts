import type { ArticleSeed } from '../types';

/** Colección 4 · Tu proyecto de Google (qué es y quién paga la IA). */
export const PROYECTO_GOOGLE: ArticleSeed[] = [
  {
    slug: 'tu-proyecto-de-google',
    title: 'Qué es tu proyecto de Google y para qué sirve',
    summary: 'Es tu propio proyecto en Google, donde se crean tus imágenes y tus vídeos con inteligencia artificial.',
    collection: 'proyecto-google',
    topic: 'proyecto',
    order: 1,
    views: 0,
    keywords: ['proyecto', 'google', 'cloud', 'imágenes', 'vídeos', 'ia', 'configurar', 'facturación'],
    assistantNotes: ['Para usar Uony y el Estudio hace falta un proyecto propio de Google Cloud con la facturación activa.'],
    body: `
## Qué es

Es un proyecto tuyo en Google. Ahí funciona la inteligencia artificial que crea tus imágenes y tus vídeos. Uonify lo prepara contigo en el alta y te explica qué se configura.

## Por qué es mío

Porque las imágenes y los vídeos los pagas a Google directamente, con tu proyecto. Así tienes el control del gasto y tu factura la emite Google.

## Qué necesito

Una cuenta de Google y un proyecto de Google Cloud con la facturación activa. En el alta, Uony te guía para dejarlo listo. Google decide, según sus condiciones, quién puede abrir una cuenta de facturación.
`,
  },
  {
    slug: 'quien-paga-imagenes-y-videos',
    title: 'Quién paga las imágenes y los vídeos',
    summary: 'Las imágenes y los vídeos los pagas a Google con tu proyecto. Ves el precio máximo antes de crear cada pieza.',
    collection: 'proyecto-google',
    topic: 'pago',
    order: 2,
    views: 0,
    keywords: ['precio', 'pago', 'google', 'factura', 'coste', 'imágenes', 'vídeos', 'euros'],
    assistantNotes: ['No dar el precio exacto de una pieza: se ve antes de crear.', 'El importe exacto está en la factura de Google.'],
    body: `
## Quién cobra

Las imágenes y los vídeos los pagas a Google directamente, con tu proyecto. Uonify no cobra por encima de eso.

## Cuánto cuesta

Depende de la pieza. Antes de crearla, Uony te enseña su precio máximo en euros y te pide tu visto bueno. El importe exacto aparece en tu factura de Google.

## Y hablar con Uony

Hablar con Uony y guardar tus planes no tiene coste. Solo pagas cuando creas una imagen o un vídeo, y siempre con tu OK.
`,
  },
  {
    slug: 'creditos-de-google',
    title: 'Créditos de Google',
    summary: 'Si tu cuenta de Google tiene créditos o una prueba, se aplican según las condiciones de Google.',
    collection: 'proyecto-google',
    topic: 'créditos',
    order: 3,
    views: 0,
    keywords: ['créditos', 'prueba gratuita', 'google', 'saldo', 'descuento', '300'],
    assistantNotes: ['No prometer créditos ni su cobertura: dependen de Google y de la cuenta.'],
    body: `
## Tengo créditos de Google

Si tu cuenta de Google tiene créditos o una prueba, se aplican a lo que creas, según las condiciones de Google. Esa cobertura la decide Google, no Uonify. Cuando el crédito se agota, Google detiene el proyecto hasta que actives el pago.

## Dónde lo veo

El consumo y los créditos de tu proyecto los ves en tu cuenta de Google.
`,
  },
];
