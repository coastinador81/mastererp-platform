import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { missingConsents } from '../model/legal';
import { checkProfile, isEmail } from '../model/profile';
import type { AuthConfig, OAuthProvider, StartRequest } from '../model/types';
import { consentsOf, sessionPayload, sessionRecord, signInAs, signOutMock, storeProfile } from './authDb';
import { consentHandlers } from './consentHandlers';
import { emailHandlers } from './emailHandlers';
import { readJson } from './readJson';

/**
 * Simulación del backend de acceso (contrato en README.md del módulo):
 * - GET  /api/auth/config         → modo «preview»: los accesos se simulan sin salir de Uonify.
 * - POST /api/auth/chatgpt/start  → con loginHint crea la sesión de ese correo (simula la vuelta de OpenAI).
 * - POST /api/auth/google/start   → igual, con Google.
 * - GET  /api/auth/session        → sesión, perfil, aceptaciones, plan de ChatGPT y si el alta está completa.
 * - POST /api/profile             → valida y guarda el perfil (mayores de 18, con las condiciones aceptadas).
 * - POST /api/auth/logout         → cierra la sesión (no desconecta el plan de ChatGPT).
 * Además, el correo con código (emailHandlers) y las aceptaciones y el plan (consentHandlers).
 */
function startHandler(provider: OAuthProvider) {
  return http.post(mock(`/auth/${provider}/start`), async ({ request }) => {
    const body = ((await readJson(request)) ?? {}) as Partial<StartRequest>;
    await latency(650);
    if (typeof body.returnTo !== 'string' || !body.returnTo) return fail(400, 'Falta la dirección de vuelta a Uonify.', 'invalid_return_to');
    const email = typeof body.loginHint === 'string' ? body.loginHint.trim() : '';
    // Sin cuenta elegida, el proveedor devolvería a Uonify sin sesión.
    if (!email) return HttpResponse.json({ authUrl: `/?auth=return&provider=${provider}` });
    if (!isEmail(email)) return fail(400, 'Introduce un correo electrónico válido.', 'invalid_email');
    return HttpResponse.json({ session: signInAs(email, provider) });
  });
}

export const handlers = [
  http.get(mock('/auth/config'), async () => {
    await latency(120);
    return HttpResponse.json({ provider: 'chatgpt', mode: 'preview', providers: ['chatgpt', 'google', 'email'] } satisfies AuthConfig);
  }),

  startHandler('chatgpt'),
  startHandler('google'),

  http.get(mock('/auth/session'), async () => {
    await latency(250);
    return HttpResponse.json(sessionPayload(sessionRecord.get().email));
  }),

  http.post(mock('/profile'), async ({ request }) => {
    const body = await readJson(request);
    await latency(700);
    const email = sessionRecord.get().email;
    if (!email) return fail(401, 'Tu sesión ha caducado. Vuelve a iniciar sesión.', 'unauthenticated');
    const checked = checkProfile(body);
    if (!checked.ok && checked.reason === 'underage') {
      return fail(403, 'Uonify está disponible solo para personas de 18 años o más.', 'age_restricted');
    }
    if (!checked.ok) return fail(400, 'Revisa los datos de tu perfil.', 'invalid_profile');
    // Nada se da por terminado sin las condiciones vigentes aceptadas.
    if (missingConsents(consentsOf(email)).length) {
      return fail(409, 'Acepta las condiciones para crear tu espacio.', 'consents_required');
    }
    const profile = storeProfile(email, checked.profile);
    return HttpResponse.json({ profileComplete: true, ageConfirmedAdult: true, profile });
  }),

  http.post(mock('/auth/logout'), async () => {
    await latency(300);
    signOutMock();
    return HttpResponse.json({ ok: true });
  }),

  ...emailHandlers,
  ...consentHandlers,
];
