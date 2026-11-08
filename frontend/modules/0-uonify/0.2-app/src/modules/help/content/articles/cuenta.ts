import type { ArticleSeed } from '../types';

/**
 * Colección 8 · Cuenta, datos y privacidad. Los textos finales de datos los entrega el
 * hilo Legal (los exige la verificación de Google); estos son la versión de partida,
 * ya veraz. «Exportar» se ofrece a petición por correo (Reglamento de Datos de la UE).
 */
export const CUENTA: ArticleSeed[] = [
  {
    slug: 'que-datos-de-drive-usa-uony',
    title: 'Qué datos de tu Drive usa Uony',
    summary: 'Uony solo usa los archivos de Google Drive que tú eliges, en modo lectura, para preparar tu trabajo.',
    collection: 'cuenta-datos-privacidad',
    topic: 'datos',
    order: 1,
    views: 0,
    keywords: ['datos', 'drive', 'lectura', 'privacidad', 'archivos', 'uso limitado'],
    assistantNotes: ['Drive en modo lectura, archivo a archivo. No se usan los datos para entrenar modelos, salvo lo necesario para la tarea.'],
    body: `
## Qué usa

Uony usa los archivos de Google Drive™ que tú eliges, archivo a archivo, para preparar tus productos y tus piezas. Los **lee**; no los modifica ni los borra.

## Qué no hace

El uso que Uonify hace de los datos de Google Workspace, incluido Google Drive, se ajusta a la Política de Datos de Usuario de los Servicios de las API de Google, incluidos los requisitos de Uso Limitado. No usamos esos datos para entrenar modelos de inteligencia artificial, salvo lo necesario para tu propia tarea. Más información en [Seguridad](/seguridad) y en la [política de privacidad](/privacidad).
`,
  },
  {
    slug: 'exportar-o-borrar-tus-datos',
    title: 'Exportar o borrar tus datos',
    summary: 'Puedes pedir una copia de tus datos por correo y borrar tu cuenta desde Configuración.',
    collection: 'cuenta-datos-privacidad',
    topic: 'derechos',
    order: 2,
    views: 0,
    keywords: ['exportar', 'borrar', 'datos', 'cuenta', 'copia', 'eliminar', 'rgpd'],
    assistantNotes: ['Derivar una solicitud de derechos al equipo. Exportar: a petición por correo mientras no haya autoservicio.'],
    body: `
## Cómo exporto mis datos

Puedes pedir una copia de tus datos escribiendo a **hola@uonify.com** desde el correo de tu cuenta. Mientras no haya un botón de autoservicio, te la preparamos a petición.

## Cómo borro mi cuenta

Abre **Configuración › Privacidad**, pulsa **Eliminar cuenta** y confirma. Uonify retira sus conexiones con Google y con tu cuenta de vendedor y borra tus datos. Las facturas se conservan el tiempo que exige la ley.
`,
  },
  {
    slug: 'entrenar-la-ia',
    title: '¿Usa Uonify mis datos para entrenar la IA?',
    summary: 'No. Uonify no usa tu contenido para entrenar modelos de inteligencia artificial.',
    collection: 'cuenta-datos-privacidad',
    topic: 'ia',
    order: 3,
    views: 0,
    keywords: ['entrenar', 'ia', 'modelos', 'datos', 'privacidad', 'contenido'],
    assistantNotes: [],
    body: `
## La respuesta corta

No. Uonify no usa tu contenido para entrenar modelos de inteligencia artificial.

## Y Google

Lo que envías a los modelos de Google se trata conforme a las condiciones de Google Cloud que aceptaste con tu proyecto. Más información en la [política de privacidad](/privacidad).
`,
  },
  {
    slug: 'tus-derechos-de-privacidad',
    title: 'Cómo ejerzo mis derechos de privacidad',
    summary: 'Puedes pedir el acceso, la rectificación, la supresión o la portabilidad de tus datos escribiendo a hola@uonify.com.',
    collection: 'cuenta-datos-privacidad',
    topic: 'derechos',
    order: 4,
    views: 0,
    keywords: ['derechos', 'privacidad', 'acceso', 'rectificación', 'supresión', 'portabilidad', 'rgpd'],
    assistantNotes: ['Derivar la solicitud al equipo. No dar plazos distintos de los publicados.'],
    body: `
## Qué puedo pedir

Puedes pedir el acceso, la rectificación, la supresión o la portabilidad de tus datos, y oponerte a ciertos tratamientos.

## Cómo lo pido

Escríbenos a **hola@uonify.com** desde el correo de tu cuenta. Más información y los detalles legales en la [política de privacidad](/privacidad).
`,
  },
];
