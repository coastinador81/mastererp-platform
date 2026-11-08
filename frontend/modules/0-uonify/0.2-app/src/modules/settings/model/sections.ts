export type SettingsSectionId = 'cuenta' | 'seguridad' | 'conexiones' | 'uso' | 'plan' | 'usuarios' | 'gpsr' | 'privacidad' | 'ayuda';

export const SETTINGS_SECTIONS: readonly SettingsSectionId[] = ['cuenta', 'seguridad', 'conexiones', 'uso', 'plan', 'usuarios', 'gpsr', 'privacidad', 'ayuda'];

/** Raíz de Configuración dentro del espacio (en móvil, la lista de secciones). */
export const SETTINGS_BASE_PATH = '/espacio/configuracion';

/** Ruta de una sección de Configuración dentro del espacio. */
export function settingsPath(section: SettingsSectionId = 'cuenta'): string {
  return `${SETTINGS_BASE_PATH}/${section}`;
}

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export interface SectionMeta {
  id: SettingsSectionId;
  label: string;
  /** Línea de contexto bajo el título de la sección. */
  description: string;
  icon: string;
}

/** Textos e iconos de cada sección (los iconos uset-* se registran en components/icons.ts). */
export const SECTION_META: Readonly<Record<SettingsSectionId, SectionMeta>> = {
  cuenta: { id: 'cuenta', label: 'Cuenta', icon: 'uset-user', description: 'Tu nombre, tu foto, tu correo, el idioma y la zona horaria.' },
  seguridad: { id: 'seguridad', label: 'Seguridad', icon: 'shield', description: 'Verificación en dos pasos, sesiones abiertas y formas de entrar en Uonify.' },
  conexiones: { id: 'conexiones', label: 'Conexiones', icon: 'uset-plug', description: 'Tu plan de ChatGPT y tus canales de venta.' },
  uso: { id: 'uso', label: 'Uso', icon: 'uset-chart', description: 'Los límites de tu plan de ChatGPT y tus tokens de Uonify.' },
  plan: { id: 'plan', label: 'Plan y facturación', icon: 'uset-card', description: 'Tu plan, los pagos, las facturas y las recargas de tokens de Uonify.' },
  usuarios: { id: 'usuarios', label: 'Usuarios', icon: 'uset-users', description: 'Las personas que trabajan en tu espacio y lo que puede hacer cada una.' },
  gpsr: { id: 'gpsr', label: 'GPSR por marca', icon: 'package', description: 'Fabricante, persona responsable en la UE y contacto de cada marca, listos para sus productos.' },
  privacidad: { id: 'privacidad', label: 'Privacidad', icon: 'uset-lock', description: 'Tus datos, las cookies y la eliminación de la cuenta.' },
  ayuda: { id: 'ayuda', label: 'Ayuda', icon: 'uset-help', description: 'Centro de ayuda y contacto con el equipo.' },
};

/** Título del documento para una sección (o para la lista, sin sección). */
export function settingsDocumentTitle(section: SettingsSectionId | null): string {
  return section ? `${SECTION_META[section].label} · Configuración — Uonify` : 'Configuración — Uonify';
}
