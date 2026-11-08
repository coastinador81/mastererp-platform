/**
 * Ayuda de Uonify: botón «Ayuda» de la cabecera (junto a los servicios) que abre el panel
 * de soporte con buscador, artículos y Uony de soporte; centro de ayuda público en /ayuda;
 * tickets y videollamadas de pago con Google Meet. Contrato: docs/FRONTEND-FASE-2.md.
 */
export { HelpButton } from './components/HelpButton';

/** Rutas públicas del centro de ayuda (para el prerender y el sitemap de public-site). */
import { SEED_ARTICLES } from './content';
export const HELP_PUBLIC_PATHS: readonly string[] = ['/ayuda', ...SEED_ARTICLES.map(a => `/ayuda/${a.slug}`)];
export { openHelp } from './hooks/panelStore';
