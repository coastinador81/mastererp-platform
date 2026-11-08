/**
 * Vistas públicas de Uonify (tabla `views` de unified.js del prototipo).
 * El PROTO las servía como `index.html?view=…`; en React cada una es una ruta.
 * Título y clase del <body> son los que aplicaba unified.js; las descripciones se
 * reescribieron para buscadores y buscadores de IA (decisión del dueño del 27-09-2026).
 * Menú del 22-10-2026 (D-WEB-PUBLICA-20261022): Cómo funciona · Servicios · Lo que
 * puedes hacer · Precios · Ayuda. Seguridad va en el pie. Novedades queda fuera del
 * menú hasta el lanzamiento (su ruta sigue viva, sin enlazar).
 */
export type PublicViewKey =
  | 'portada'
  | 'producto'
  | 'como-funciona'
  | 'lo-que-puedes-hacer'
  | 'partners'
  | 'clientes'
  | 'precios'
  | 'seguridad'
  | 'para-empresas'
  | 'empresa'
  | 'novedades'
  | 'privacidad'
  | 'terminos';

export interface PublicViewMeta {
  key: PublicViewKey;
  /** Ruta de la aplicación. */
  path: string;
  title: string;
  /** Meta descripción (buscadores y al compartir). */
  description: string;
  bodyClass?: string;
}

/** Ruta del espacio de trabajo (módulo workspace). */
export const WORKSPACE_PATH = '/espacio';

export const PUBLIC_VIEWS: Record<PublicViewKey, PublicViewMeta> = {
  portada: {
    key: 'portada',
    path: '/',
    title: 'Uonify — Hazlo posible',
    description: 'Uonify reúne tus productos, tus canales y la IA en un mismo espacio: prepara fichas, imágenes y vídeo para Amazon y tu tienda online, y pagas a Google solo lo que usas.',
  },
  producto: {
    key: 'producto',
    path: '/productos',
    title: 'Servicios — Uonify',
    description: 'Todo lo que hace Uonify: fichas de producto, imágenes, contenido A+, modelos 3D, el Estudio creativo de vídeo y Nexus para conectar tus canales, con Uony a tu lado.',
  },
  'como-funciona': {
    key: 'como-funciona',
    path: '/como-funciona',
    title: 'Cómo funciona Uonify — De una petición a un resultado',
    description: 'Pide lo que necesitas con tus palabras: Uonify conecta tu contexto, coordina las herramientas y te deja revisar cada resultado antes de llevarlo a cada canal.',
    bodyClass: 'how-page',
  },
  'lo-que-puedes-hacer': {
    key: 'lo-que-puedes-hacer',
    path: '/lo-que-puedes-hacer',
    title: 'Lo que puedes hacer con Uonify',
    description: 'Lo que puedes hacer con Uonify: publicar un producto en Amazon desde cero y crear contenido para redes, con tus archivos o empezando de cero. Siempre se puede empezar desde cero.',
    bodyClass: 'can-do-page',
  },
  precios: {
    key: 'precios',
    path: '/precios',
    title: 'Precios — Uonify',
    description: 'Precios de Uonify: una suscripción única y clara. La IA y la creación las pagas a Google, a sus precios y sin recargo de Uonify. Antes de crear cada pieza ves su precio máximo.',
    bodyClass: 'pricing-page',
  },
  partners: {
    key: 'partners',
    path: '/partners',
    title: 'Partners autorizados — Uonify',
    description: 'Programa de partners autorizados de Uonify: empresas que implantan la herramienta, hacen el onboarding y acompañan a sus clientes. Consulta el directorio y solicita unirte.',
    bodyClass: 'partners-page',
  },
  clientes: {
    key: 'clientes',
    path: '/clientes',
    title: 'Clientes — Uonify',
    description: 'Marcas que trabajan con Uonify para preparar sus productos, su contenido y su operación.',
    bodyClass: 'clientes-page',
  },
  seguridad: {
    key: 'seguridad',
    path: '/seguridad',
    title: 'Seguridad — Uonify',
    description: 'Seguridad en Uonify: tus archivos siguen en tu cuenta de Google, eliges archivo a archivo qué ve Uony, y tus claves y tu información están protegidas de principio a fin.',
    bodyClass: 'security-page',
  },
  'para-empresas': {
    key: 'para-empresas',
    path: '/para-empresas',
    title: 'Para equipos y marcas — Uonify',
    description: 'Uonify para equipos y marcas: una operación de e-commerce conectada, con la IA de Google y el control humano de tu equipo sobre cada decisión.',
    bodyClass: 'enterprise-page',
  },
  empresa: {
    key: 'empresa',
    path: '/sobre-uonify',
    title: 'Sobre Uonify — Lo que creas tiene muchas posibilidades',
    description: 'Herramientas e inteligencia artificial al alcance de más personas. Descubre cómo Uonify conecta los productos, las tareas y las decisiones que hacen crecer un negocio.',
    bodyClass: 'about-page',
  },
  novedades: {
    key: 'novedades',
    path: '/novedades',
    title: 'Novedades — Nuevas piezas. Más posibilidades. — Uonify',
    description: 'Descubre lo que estamos construyendo en Uonify: nuevas posibilidades para tus productos, herramientas en desarrollo y una forma más conectada de trabajar.',
    bodyClass: 'news-page',
  },
  privacidad: {
    key: 'privacidad',
    path: '/privacidad',
    title: 'Privacidad — Uonify',
    description: 'Privacidad en Uonify: qué ocurre con lo que escribes en la web, cómo se guardan tus preferencias visuales y qué política de privacidad se aplica.',
  },
  terminos: {
    key: 'terminos',
    path: '/terminos',
    title: 'Condiciones — Uonify',
    description: 'Condiciones de Uonify: información sobre el acceso, los servicios externos y las acciones del espacio de trabajo, y las condiciones de servicio aplicables.',
  },
};

/** Rutas públicas por clave de vista (atajo para enlaces). */
export const PATHS = {
  home: PUBLIC_VIEWS.portada.path,
  composer: `${PUBLIC_VIEWS.portada.path}#composer`,
  productos: PUBLIC_VIEWS.producto.path,
  comoFunciona: PUBLIC_VIEWS['como-funciona'].path,
  loQuePuedesHacer: PUBLIC_VIEWS['lo-que-puedes-hacer'].path,
  precios: PUBLIC_VIEWS.precios.path,
  partners: PUBLIC_VIEWS.partners.path,
  clientes: PUBLIC_VIEWS.clientes.path,
  seguridad: PUBLIC_VIEWS.seguridad.path,
  paraEmpresas: PUBLIC_VIEWS['para-empresas'].path,
  sobreUonify: PUBLIC_VIEWS.empresa.path,
  novedades: PUBLIC_VIEWS.novedades.path,
  privacidad: PUBLIC_VIEWS.privacidad.path,
  terminos: PUBLIC_VIEWS.terminos.path,
} as const;

/** Vistas que se pueden abrir sin sesión (todas las públicas, legales incluidas). */
export const PUBLIC_PATHS: readonly string[] = Object.values(PUBLIC_VIEWS).map(view => view.path);

export function isPublicViewKey(value: unknown): value is PublicViewKey {
  return typeof value === 'string' && Object.hasOwn(PUBLIC_VIEWS, value);
}
