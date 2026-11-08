import type { ArticleSeed } from '../types';

/** Colección 6 · Amazon y fichas (conectar, preparar y revisar). */
export const AMAZON: ArticleSeed[] = [
  {
    slug: 'conectar-cuenta-amazon',
    title: 'Conectar tu cuenta de vendedor de Amazon',
    summary: 'Conecta tu cuenta de vendedor para trabajar tu catálogo desde Uonify. Uonify no guarda tu contraseña.',
    collection: 'amazon',
    topic: 'conexión',
    order: 1,
    views: 0,
    keywords: ['amazon', 'vendedor', 'conectar', 'autorizar', 'catálogo', 'desconectar'],
    assistantNotes: ['Nunca pedir las claves ni la contraseña de la cuenta de vendedor.', 'No prometer que Amazon apruebe fichas ni resultados de venta.'],
    body: `
## Qué necesito

Una cuenta de vendedor profesional y permiso para autorizar aplicaciones.

## Cómo la conecto

En **Nexus**, pulsa **Conectar** en Amazon y autoriza a Uonify en tu cuenta de vendedor. Al terminar, vuelves con la cuenta conectada.

## Qué datos usa Uonify

Uonify trabaja tu catálogo: fichas, categorías, imágenes y contenido. No usamos datos personales de tus compradores y nunca guardamos tu contraseña.

## Cómo la desconecto

En Nexus, pulsa **Desconectar**. También puedes retirar el permiso desde tu cuenta de vendedor.
`,
  },
  {
    slug: 'preparar-una-ficha',
    title: 'Preparar una ficha',
    summary: 'Uony reúne los datos, propone los textos y te marca lo que falta para que la ficha esté lista.',
    collection: 'amazon',
    topic: 'ficha',
    order: 2,
    views: 0,
    keywords: ['ficha', 'producto', 'atributos', 'categoría', 'imágenes', 'gpsr', 'preparar'],
    assistantNotes: [],
    body: `
## Cómo la preparo

Dile a Uony qué producto quieres preparar. Reúne la información, propone el título y la descripción, prepara las imágenes y te marca lo que falta para la categoría de tu producto.

## Qué necesita una ficha

Tu cuenta de vendedor conectada, la categoría del producto, sus atributos obligatorios, las imágenes y los datos de seguridad que pide tu mercado. Uony te avisa de lo que falte.

## Lo reviso

Tú revisas cada propuesta y decides qué conservar antes de seguir.
`,
  },
  {
    slug: 'revisar-y-enviar-a-amazon',
    title: 'Revisar y enviar a Amazon',
    summary: 'Ves la vista previa exacta de lo que se enviará y la apruebas antes de que salga.',
    collection: 'amazon',
    topic: 'publicar',
    order: 3,
    views: 0,
    keywords: ['publicar', 'enviar', 'vista previa', 'aprobar', 'amazon', 'errores'],
    assistantNotes: ['No prometer que Amazon apruebe o muestre una ficha, ni plazos de Amazon.'],
    body: `
## Cómo envío una ficha

Uony te enseña la vista previa exacta de lo que se va a enviar a tu cuenta de vendedor. Revisas y apruebas ese envío.

## Qué responde Amazon

Tu cuenta de vendedor revisa cada envío y responde si lo acepta, si recomienda corregir algo o si hay errores. Uony te muestra esos mensajes para que sepas qué ajustar.

## Cuánto tarda en verse

El tiempo que tarda en mostrarse depende de Amazon, no de Uonify.
`,
  },
];
