import { vi } from 'vitest';

/**
 * Doble del módulo auth para las pruebas de la web pública: sesión controlable y
 * openSignIn espiado. Uso: vi.mock('@/modules/auth', () => authMock) y authState.status = 'ready'.
 */
export const authState: { status: 'loading' | 'signed-out' | 'onboarding' | 'ready' } = { status: 'signed-out' };

export const openSignIn = vi.fn(async () => undefined);

export const authMock = {
  openSignIn,
  AuthDialogs: () => null,
  useSession: () => ({ status: authState.status, user: null, profile: null }),
  useAuthLinks: () => {
    const signedIn = authState.status === 'ready' || authState.status === 'onboarding';
    const ready = authState.status === 'ready';
    return {
      loginLink: signedIn ? (ready ? 'Volver a mi espacio' : 'Completar perfil') : 'Iniciar sesión',
      identityTrigger: signedIn ? (ready ? 'Ir a mi espacio' : 'Completar perfil') : 'Iniciar sesión',
      homeHref: signedIn ? '/espacio' : '/',
      homeLabel: signedIn ? 'Uonify, volver a mi espacio' : 'Uonify, ir al inicio',
    };
  },
};
