import { acceptConsents } from '../api/authApi';
import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import { setupServer } from 'msw/node';
import { ApiError } from '@/shared/api/client';
import { fetchAuthConfig, fetchSession, logout, saveProfile, startChatGPTAccess } from '../api/authApi';
import { resetAuthDb } from '../mocks/authDb';
import { handlers } from '../mocks/handlers';
import type { Profile } from '../model/types';

// Sin latencia simulada en las pruebas.
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => resetAuthDb());
afterAll(() => server.close());

const returnTo = 'http://localhost:3000/?auth=return';
const profile: Profile = {
  firstName: 'Ana',
  lastName: 'García',
  name: 'Ana García',
  email: 'otro@correo.es',
  ageRange: '35-44',
  role: 'seller',
  companySize: '1',
  company: '',
  primaryGoal: 'explore',
  source: '',
  desiredPlan: 'max',
  billingInterval: 'monthly',
};

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof ApiError ? error.status : -1;
  }
}

describe('simulación del backend de acceso', () => {
  test('la configuración pide elegir la cuenta sin salir de Uonify', async () => {
    expect(await fetchAuthConfig()).toEqual({ provider: 'chatgpt', mode: 'preview', providers: ['chatgpt', 'google', 'email'] });
  });

  test('sin sesión, /api/auth/session responde que no está iniciada', async () => {
    expect(await fetchSession()).toMatchObject({ authenticated: false });
  });

  test('start con el correo elegido crea la sesión de esa cuenta', async () => {
    const result = await startChatGPTAccess({ returnTo, loginHint: ' ana@tienda.es ' });
    expect(result.session).toMatchObject({ authenticated: true, email: 'ana@tienda.es', profileComplete: false, ageConfirmedAdult: false });
    expect(await fetchSession()).toMatchObject({ authenticated: true, email: 'ana@tienda.es', profile: null, profileReady: false });
  });

  test('start sin cuenta devuelve la vuelta a Uonify; con un correo inválido, 400', async () => {
    expect(await startChatGPTAccess({ returnTo })).toEqual({ authUrl: '/?auth=return&provider=chatgpt' });
    expect(await status(startChatGPTAccess({ returnTo, loginHint: 'no-es-correo' }))).toBe(400);
  });

  test('el perfil exige sesión, datos completos y mayoría de edad', async () => {
    expect(await status(saveProfile(profile))).toBe(401);
    await startChatGPTAccess({ returnTo, loginHint: 'ana@tienda.es' });
    expect(await status(saveProfile({ ...profile, ageRange: 'under18' }))).toBe(403);
    expect(await status(saveProfile({ ...profile, primaryGoal: '' }))).toBe(400);
    expect(await status(saveProfile(profile))).toBe(409);
    await acceptConsents(TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })));
    const saved = await saveProfile(profile);
    // El correo de la cuenta manda sobre el del formulario.
    expect(saved).toEqual({ profileComplete: true, ageConfirmedAdult: true, profile: { ...profile, email: 'ana@tienda.es' } });
    const session = await fetchSession();
    expect(session.profileReady).toBe(true);
    expect(session.profile).toMatchObject({ firstName: 'Ana', desiredPlan: 'max', email: 'ana@tienda.es' });
  });

  test('cada correo tiene su perfil y logout cierra la sesión', async () => {
    await startChatGPTAccess({ returnTo, loginHint: 'ana@tienda.es' });
    await acceptConsents(TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })));
    await saveProfile(profile);
    await startChatGPTAccess({ returnTo, loginHint: 'luis@tienda.es' });
    expect((await fetchSession()).profileReady).toBe(false);
    await startChatGPTAccess({ returnTo, loginHint: 'ANA@tienda.es' });
    expect((await fetchSession()).profileReady).toBe(true);
    await logout();
    expect((await fetchSession()).authenticated).toBe(false);
  });
});
