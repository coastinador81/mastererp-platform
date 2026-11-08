/**
 * Configuración de la cuenta (/espacio/configuracion/:seccion). Puerta única del módulo.
 * Secciones: cuenta, seguridad, conexiones, uso, plan (del módulo billing), usuarios,
 * gpsr, privacidad y ayuda. Contrato: docs/FRONTEND-FASE-2.md.
 */
export { SETTINGS_SECTIONS, settingsPath, type SettingsSectionId } from './model/sections';
export type { BrandGpsrProfile, StoredBrandProfile } from './model/brandGpsrProfile';
export { GpsrSection } from './components/gpsr/GpsrSection';
