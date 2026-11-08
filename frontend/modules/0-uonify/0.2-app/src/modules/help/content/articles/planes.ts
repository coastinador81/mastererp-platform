import type { ArticleSeed } from '../types';

/**
 * Colección 7 · Plan y cuenta (precio, pago y baja). Los textos finales de pago y
 * desistimiento los entrega el hilo Legal; estos son la versión de partida, ya veraz.
 * Precio con IVA incluido (Uonify también es para particulares; Legal 23-10).
 */
export const PLANES: ArticleSeed[] = [
  {
    slug: 'precio-y-pago',
    title: 'Precio y pago',
    summary: 'Uonify cuesta 11,98 € al mes o 143,75 € al año, con el IVA de España incluido (el IVA final depende de tu país). La base sin IVA es 9,90 € al mes. Se paga al entrar, con 14 días para darte de baja.',
    collection: 'plan-y-cuenta',
    topic: 'precio',
    order: 1,
    views: 0,
    keywords: ['precio', 'plan', 'mensual', 'anual', 'pago', '14 días', 'desistimiento', 'iva', 'suscripción'],
    assistantNotes: ['Los precios vigentes están en Configuración.', 'No hay prueba gratuita: se paga al entrar con 14 días de desistimiento.', 'Base neta 9,90/118,80 + IVA por país (Stripe Tax); se muestra con IVA incluido, por defecto el de España. El anual no tiene descuento. El consumo de Google es aparte. Nunca decir «+ IVA» solo.'],
    body: `
## Cuánto cuesta

Uonify cuesta **11,98 € al mes** o **143,75 € al año** (pago anual), con el IVA de España incluido. El IVA depende de tu país y el precio final se muestra antes de pagar. La base sin IVA es 9,90 € al mes; las empresas con número de IVA válido pagan esa base sin IVA.

## Cómo se paga

Se paga al entrar: el pago es el último paso del alta. Tienes 14 días para darte de baja; te devolvemos tu cuota, menos los días que la hayas usado. El pago anual cuesta lo mismo que 12 meses del mensual (143,75 € al año equivale a 11,98 € al mes).

## Qué necesito además

Para usar Uony y el Estudio necesitas tu propio proyecto de Google Cloud con la facturación activa. Las imágenes y los vídeos los pagas a Google con tu proyecto; consulta [Quién paga las imágenes y los vídeos](/ayuda/quien-paga-imagenes-y-videos).

## Qué incluye

El plan incluye Uony, tus productos, el Estudio y tus conexiones.
`,
  },
  {
    slug: 'darse-de-baja',
    title: 'Cómo me doy de baja en los 14 primeros días',
    summary: 'Te das de baja desde tu cuenta. En los primeros 14 días te devolvemos tu cuota menos los días que la hayas usado.',
    collection: 'plan-y-cuenta',
    topic: 'baja',
    order: 2,
    views: 0,
    keywords: ['cancelar', 'baja', 'desistimiento', '14 días', 'reembolso', 'devolución'],
    assistantNotes: ['No prometer plazos de devolución: dependen del banco.', 'El texto exacto del desistimiento lo fija el hilo Legal.'],
    body: `
## Cómo me doy de baja

Abre **Configuración › Plan** y da de baja la renovación. No hace falta contactar con nadie.

## Qué me devolvéis

Si estás en los primeros 14 días, te devolvemos tu cuota menos los días que la hayas usado. Si no, conservas el acceso hasta el final del periodo que ya pagaste.

## Qué pasa con mi trabajo

Tu trabajo se conserva. Cancelar no borra tus productos ni tus piezas. El texto legal del desistimiento está en las [Condiciones](/terminos).
`,
  },
  {
    slug: 'cancelar-la-renovacion',
    title: 'Cómo cancelo la renovación',
    summary: 'Cancelas la renovación desde Configuración cuando quieras; conservas el acceso hasta el final del periodo que ya pagaste.',
    collection: 'plan-y-cuenta',
    topic: 'renovación',
    order: 3,
    views: 0,
    keywords: ['renovación', 'cancelar', 'renovar', 'acceso', 'periodo'],
    assistantNotes: [],
    body: `
## Dónde se cancela

En **Configuración › Plan**, desactiva la renovación automática. No se vuelve a cobrar al terminar el periodo.

## Hasta cuándo tengo acceso

Conservas el acceso hasta el final del periodo que ya pagaste. Puedes volver a activar la renovación antes de esa fecha.
`,
  },
  {
    slug: 'que-cobra-uonify-y-cada-proveedor',
    title: 'Qué me cobra Uonify y qué cada proveedor',
    summary: 'Uonify te cobra la suscripción. La IA y la creación de contenido las pagas a Google, a sus precios, desde tu propio proyecto.',
    collection: 'plan-y-cuenta',
    topic: 'facturación',
    order: 4,
    views: 0,
    keywords: ['factura', 'cobro', 'uonify', 'google', 'proveedor', 'suscripción', 'consumo'],
    assistantNotes: ['Uonify no revende el uso de Google ni cobra por encima.'],
    body: `
## Qué me cobra Uonify

La suscripción: 11,98 € al mes o 143,75 € al año, con el IVA de España incluido (el IVA final depende de tu país; la base sin IVA es 9,90 € al mes). Nada más.

## Qué paga a Google

La inteligencia artificial y la creación de imágenes y vídeos las pagas a Google, a sus precios, desde tu propio proyecto. Uonify no cobra por encima de eso. Antes de crear cada pieza ves su precio máximo.

## Los textos de pago

El detalle legal de la facturación y el desistimiento está en las [Condiciones de pago](/terminos).
`,
  },
];
