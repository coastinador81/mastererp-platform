import type { HelpCollection } from '../model/types';

/**
 * Colecciones del centro de ayuda (orden de la portada), según la maqueta aprobada
 * de Ayuda (D-WEB-PUBLICA-20261022). Ocho colecciones; el contacto/soporte va en el
 * bloque superior de la página, no como colección.
 */
export const SEED_COLLECTIONS: HelpCollection[] = [
  { id: 'primeros-pasos', title: 'Primeros pasos', description: 'Entrar, el alta y empezar con Uony.', icon: 'hlp-rocket', order: 1 },
  { id: 'uony', title: 'Uony', description: 'Hablar con Uony y qué puede hacer por ti.', icon: 'uony', order: 2 },
  { id: 'drive-y-conexiones', title: 'Google Drive y conexiones', description: 'Tus archivos y tus cuentas, bajo tu control.', icon: 'hlp-folder', order: 3 },
  { id: 'proyecto-google', title: 'Tu proyecto de Google', description: 'Qué es y quién paga la IA.', icon: 'hlp-card', order: 4 },
  { id: 'estudio', title: 'Estudio', description: 'Imágenes y vídeos con IA.', icon: 'palette', order: 5 },
  { id: 'amazon', title: 'Amazon y fichas', description: 'Conectar, preparar y revisar.', icon: 'package', order: 6 },
  { id: 'plan-y-cuenta', title: 'Plan y cuenta', description: 'Precio, pago y darse de baja.', icon: 'hlp-lifebuoy', order: 7 },
  { id: 'cuenta-datos-privacidad', title: 'Cuenta, datos y privacidad', description: 'Tus datos y tus derechos.', icon: 'shield', order: 8 },
];
