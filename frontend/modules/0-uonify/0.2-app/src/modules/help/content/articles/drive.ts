import type { ArticleSeed } from '../types';

/** Colección 3 · Google Drive y conexiones (Drive archivo a archivo y Nexus). */
export const DRIVE: ArticleSeed[] = [
  {
    slug: 'conectar-google-drive',
    title: 'Conectar tu Google Drive',
    summary: 'Conecta tu Google Drive™ para que Uony trabaje con tus archivos. Lo usa en modo lectura y solo con lo que autorizas.',
    collection: 'drive-y-conexiones',
    topic: 'drive',
    order: 1,
    views: 0,
    keywords: ['google drive', 'conectar', 'archivos', 'selector', 'elegir', 'permisos', 'desconectar'],
    assistantNotes: ['Drive se usa en modo lectura.', 'No pedir nunca la contraseña de Google.'],
    body: `
## Para qué sirve

Con tu Google Drive™ conectado, Uony puede trabajar con tus fotos y documentos para preparar tus productos y crear imágenes y vídeos.

## Cómo lo conecto

Desde el alta, o en **Nexus**, pulsa **Conectar** en Google Drive y autoriza el acceso en Google.

## Qué puede hacer Uony con mis archivos

Uony los **lee** para preparar tu trabajo. No los modifica ni los borra. Trabaja solo con lo que tú autorizas. Más detalle en [Elegir tus archivos](/ayuda/elegir-tus-archivos).

## Cómo lo desconecto

En Nexus, pulsa **Desconectar**. También puedes retirar el permiso desde tu cuenta de Google.
`,
  },
  {
    slug: 'elegir-tus-archivos',
    title: 'Elegir tus archivos',
    summary: 'Eliges archivo a archivo, con el selector de Google, lo que Uony puede usar. No busca ni analiza carpetas enteras.',
    collection: 'drive-y-conexiones',
    topic: 'drive',
    order: 2,
    views: 0,
    keywords: ['elegir', 'archivos', 'selector', 'carpeta', 'drive', 'permisos'],
    assistantNotes: ['D-DRIVE-ARCHIVO-A-ARCHIVO: se elige archivo a archivo con el selector de Google. Uony no lista ni analiza carpetas.'],
    body: `
## Cómo elijo qué ve Uony

Eliges **archivo a archivo**, con el selector de Google, los archivos que quieres que Uony use. Uony solo ve esos archivos y los que Uonify guarda en su propia carpeta «Uonify».

## No mira mis carpetas

Uony no busca, lista ni analiza carpetas enteras. Trabaja únicamente con los archivos que tú le eliges, cuando se los eliges.
`,
  },
  {
    slug: 'que-ve-uony-y-que-no',
    title: 'Qué ve Uony y qué no',
    summary: 'Uony solo consulta lo que autorizas, en modo lectura. Tus claves no salen del servidor.',
    collection: 'drive-y-conexiones',
    topic: 'privacidad',
    order: 3,
    views: 0,
    keywords: ['privacidad', 'lectura', 'permisos', 'datos', 'seguridad', 'claves'],
    assistantNotes: [],
    body: `
## Qué consulta

Uony consulta los archivos de Google Drive™ que autorizas, para preparar tus productos y tus piezas. Nada más.

## Qué no hace

No modifica ni borra tus archivos. No usa tus datos para entrenar modelos de inteligencia artificial, salvo lo necesario para tu propia tarea.

## Mis claves

Las conexiones se guardan en el servidor de Uonify, nunca en tu navegador. Más información en [Seguridad](/seguridad).
`,
  },
  {
    slug: 'nexus-y-desconectar',
    title: 'Nexus y desconectar',
    summary: 'Nexus es el centro donde conectas y desconectas tus cuentas: Amazon, Google Drive y tu proyecto de Google.',
    collection: 'drive-y-conexiones',
    topic: 'nexus',
    order: 4,
    views: 0,
    keywords: ['nexus', 'conexiones', 'amazon', 'drive', 'google', 'permisos', 'desconectar'],
    assistantNotes: [],
    body: `
## Qué es Nexus

Nexus reúne todas tus conexiones en un sitio. Desde ahí conectas tu cuenta de vendedor de Amazon, tu Google Drive™ y tu proyecto de Google, ves qué permisos tiene cada una y las desconectas cuando quieras.

## Dónde está

En tu espacio, abre **Nexus** desde el menú de servicios.
`,
  },
];
