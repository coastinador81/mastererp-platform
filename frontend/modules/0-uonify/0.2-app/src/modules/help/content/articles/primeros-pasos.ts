import type { ArticleSeed } from '../types';

/** Colección 1 · Primeros pasos (qué es Uonify, entrar con Google y el alta). */
export const PRIMEROS_PASOS: ArticleSeed[] = [
  {
    slug: 'que-es-uonify-y-uony',
    title: 'Qué es Uonify y quién es Uony',
    summary: 'Uonify es tu espacio para preparar y publicar productos; Uony es la inteligencia artificial con la que trabajas hablando o escribiendo.',
    collection: 'primeros-pasos',
    topic: 'empezar',
    order: 1,
    views: 0,
    keywords: ['uonify', 'uony', 'qué es', 'inteligencia artificial', 'empezar', 'servicios'],
    assistantNotes: ['Uony funciona con la tecnología de Google. Nunca nombrar ChatGPT.'],
    body: `
## Qué es Uonify

Uonify reúne tus productos, tus canales y la inteligencia artificial en un solo sitio. Preparas las fichas de tus productos, creas imágenes y vídeos, y los llevas a tu cuenta de vendedor de Amazon y a tu tienda.

## Quién es Uony

Uony es la inteligencia artificial de Uonify, y funciona con la tecnología de Google. Trabajas con ella conversando: le pides lo que necesitas con tus palabras, por escrito y, cuando esté disponible, por voz. Uony reúne el contexto de tus productos, hace el trabajo con las herramientas adecuadas y te deja revisar cada resultado. Tú decides qué se publica y qué se crea.

## Por dónde empiezo

Entra en Uonify y cuéntale a Uony qué quieres hacer. No hace falta aprender dónde está cada función. Si prefieres trabajar a mano, cada servicio tiene su propia pantalla, con el mismo trabajo que ves en la conversación.
`,
  },
  {
    slug: 'entrar-en-uonify',
    title: 'Entrar en Uonify con tu cuenta de Google',
    summary: 'Entras en Uonify con tu cuenta de Google. Es la misma cuenta con la que trabajas con tus archivos y creas imágenes y vídeos.',
    collection: 'primeros-pasos',
    topic: 'acceso',
    order: 2,
    views: 0,
    keywords: ['entrar', 'acceso', 'iniciar sesión', 'google', 'cuenta', 'mayor de edad', 'contraseña'],
    assistantNotes: ['No pedir nunca la contraseña de Google. Uonify no la ve.', 'Para usar Uonify hay que ser mayor de edad.'],
    body: `
## Cómo entro

En la pantalla de acceso, pulsa **Continuar con Google** y elige tu cuenta. Uonify no ve tu contraseña: el acceso lo autoriza Google.

## Por qué con Google

Con tu cuenta de Google, Uony puede trabajar con los archivos de tu Google Drive™ que autorices y crear imágenes y vídeos en tu propio proyecto de Google. Usa siempre la misma cuenta para volver a tu espacio.

## Requisitos

Para usar Uonify tienes que ser mayor de edad. Las funciones de inteligencia artificial no están disponibles para menores.

## No puedo entrar

- Si la ventana de Google no se abre, permite las ventanas emergentes de Uonify en tu navegador y vuelve a intentarlo.
- Si aparece un error al volver, cierra la pestaña, abre Uonify de nuevo y repite el acceso.

Nadie de Uonify te pedirá nunca tu contraseña.
`,
  },
  {
    slug: 'el-alta-paso-a-paso',
    title: 'El alta, paso a paso',
    summary: 'La primera vez preparas tu cuenta en unos pasos: tu perfil, tu Google Drive, tu proyecto de Google y el pago de tu suscripción, que es el último paso para entrar.',
    collection: 'primeros-pasos',
    topic: 'alta',
    order: 3,
    views: 0,
    keywords: ['alta', 'onboarding', 'registro', 'perfil', 'drive', 'proyecto', 'suscripción', 'pago'],
    assistantNotes: ['No hay prueba gratuita: se paga al entrar con 14 días de desistimiento.'],
    body: `
## Qué pasa la primera vez

Al entrar por primera vez, Uony te acompaña en un alta corta:

1. **Tu perfil**: tu nombre y a qué te dedicas.
2. **Google Drive™**: si quieres, conectas tu Drive para que Uony trabaje con tus archivos. Puedes conectarlo más tarde.
3. **Tu proyecto de Google**: se prepara tu proyecto de Google para crear imágenes y vídeos. Uony te explica qué se configura y para qué sirve.
4. **Tu suscripción**: eliges pago mensual o anual y pagas para entrar. Tienes 14 días para darte de baja; te devolvemos tu cuota, menos los días que la hayas usado.

## Puedo dejarlo a medias

Sí. Uony conserva lo que ya hiciste. Al volver, sigues donde lo dejaste.

## Para qué sirve cada cosa

Más detalle en [Conectar tu Google Drive](/ayuda/conectar-google-drive) y [Tu proyecto de Google](/ayuda/tu-proyecto-de-google).
`,
  },
];
