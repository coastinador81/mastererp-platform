/**
 * Claves de sessionStorage del acceso (las del prototipo). Solo guardan datos de
 * interfaz: la petición pendiente, la última cuenta y el borrador del alta.
 * Nunca credenciales ni tokens.
 */
export const STORAGE_KEYS = {
  /** Petición escrita antes de entrar; el espacio la recoge con takePendingPrompt(). */
  pendingPrompt: 'uonify-auth-pending-prompt',
  /** Servicio pulsado sin sesión en el panel de la web; al entrar, el espacio abre ese servicio. */
  pendingService: 'uonify-auth-pending-service',
  /** Última cuenta con la que se entró (para detectar el cambio de cuenta). */
  identity: 'uonify-auth-preview-identity',
  /** Borrador del alta (datos de la propia persona) para retomarlo donde se dejó. */
  onboarding: 'uonify-auth-onboarding',
  /** Estado del espacio del prototipo; se borra al cambiar de cuenta o salir. */
  workspace: 'uonify-home-workspace-v1',
} as const;

// Claves del prototipo que ya no se usan (la sesión la guarda el backend).
const LEGACY_KEYS = ['uonify-auth-preview-session', 'uonify-auth-preview-profile', 'uonify-workspace-opening'];

export function readKey(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* El almacenamiento es opcional. */
  }
}

export function removeKey(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Nada que borrar. */
  }
}

/** Limpieza al cerrar sesión (prototipo: signOut). */
export function clearAuthStorage(): void {
  [...Object.values(STORAGE_KEYS), ...LEGACY_KEYS].forEach(removeKey);
}
