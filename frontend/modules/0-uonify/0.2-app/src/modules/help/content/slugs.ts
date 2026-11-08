/**
 * Slugs de los artículos iniciales, sin su contenido: así index.ts puede publicar
 * HELP_PUBLIC_PATHS sin meter todos los artículos en el paquete principal.
 * Una prueba comprueba que coinciden con content/index.ts.
 */
export const HELP_ARTICLE_SLUGS = [
  'entrar-en-uonify',
  'conectar-chatgpt',
  'planes-anuales',
  'tokens-de-uonify',
  'desistimiento-14-dias',
  'conectar-amazon-seller-central',
  'publicar-una-ficha',
  'gpsr-por-marca',
  'video-con-uony',
  'verificacion-en-dos-pasos',
  'privacidad-y-borrado-de-datos',
  'contacto',
] as const;
