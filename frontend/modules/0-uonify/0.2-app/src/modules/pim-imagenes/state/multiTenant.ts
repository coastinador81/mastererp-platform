import { currentAccountEmail } from '@/modules/auth';

/**
 * localStorage con el prefijo del usuario (prototipo: utils/multiTenantStorage.ts
 * dentro de pim/imagenes.js). Guarda las imágenes scrapeadas de cada producto
 * (`scraped_images_<sku>`) para recuperarlas al volver. Solo URLs de imágenes:
 * nunca claves ni tokens.
 */

// La cuenta la da el módulo auth; si no hay, como el prototipo ('uonify-session').
function userKey(key: string): string {
  let userId: string | null = currentAccountEmail();
  if (userId) return `${userId}:${key}`;
  try {
    const session = JSON.parse(localStorage.getItem('uonify-session') || 'null') as { user?: { email?: string; id?: string } } | null;
    userId = session?.user?.email || session?.user?.id || null;
  } catch {
    userId = null;
  }
  return userId ? `${userId}:${key}` : key;
}

export const multiTenant = {
  getItem(key: string): unknown {
    try {
      const value = localStorage.getItem(userKey(key));
      if (!value) return null;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    } catch {
      return null;
    }
  },
  setItem(key: string, value: unknown): void {
    try {
      localStorage.setItem(userKey(key), typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      /* almacenamiento bloqueado o lleno: la galería sigue funcionando en la sesión */
    }
  },
};

export const scrapedStorageKey = (key: string): string => `scraped_images_${key}`;
