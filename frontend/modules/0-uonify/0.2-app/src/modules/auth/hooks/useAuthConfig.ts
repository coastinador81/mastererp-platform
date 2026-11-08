import { USE_MOCKS } from '@/shared/api/config';
import { useQuery } from '@tanstack/react-query';
import type { AuthConfig, AuthProvider } from '../model/types';
import { configQuery } from '../state/session';

const ALL_PROVIDERS: readonly AuthProvider[] = ['chatgpt', 'google', 'email'];

/** Configuración del acceso; solo se pide cuando `enabled` (p. ej. con el diálogo abierto). */
export function useAuthConfig(enabled = true): AuthConfig | undefined {
  return useQuery({ ...configQuery, enabled }).data;
}

/** Formas de entrar disponibles (por defecto, las tres). */
export function useProviders(enabled = true): readonly AuthProvider[] {
  const list = useAuthConfig(enabled)?.providers;
  return list ? ALL_PROVIDERS.filter(provider => list.includes(provider)) : USE_MOCKS ? ALL_PROVIDERS : [];
}

/**
 * Accesos simulados (modo «preview»): en la versión de revisión se marcan con
 * <SimulatedBadge/>. Mientras no se sabe, se trata como real (no se marca).
 */
export function usePreviewMode(enabled = true): boolean {
  return useAuthConfig(enabled)?.mode === 'preview';
}
