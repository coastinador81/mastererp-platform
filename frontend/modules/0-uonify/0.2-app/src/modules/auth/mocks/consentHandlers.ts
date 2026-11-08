import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { CONSENT_DOCUMENTS, isConsentId, TERMS_STEP_CONSENTS } from '../model/legal';
import type { ChatGPTPlanStatus, ConsentRecord } from '../model/types';
import { consentsOf, planOf, recordConsents, sessionRecord, storePlan } from './authDb';
import { readJson } from './readJson';

/**
 * Simulación de las aceptaciones versionadas y del permiso del plan de ChatGPT:
 * - GET    /api/auth/consents        → { consents: [{ id, version, acceptedAt }] }
 * - POST   /api/auth/consents        { consents: [{ id, version }] } (Condiciones, Privacidad y cláusula de IA)
 * - GET    /api/auth/chatgpt/plan    → { plan: { status, email?, connectedAt? } }
 * - POST   /api/auth/chatgpt/plan    { returnTo, consentVersion } → preview: { plan, consents } · real: { authUrl }
 * - DELETE /api/auth/chatgpt/plan    → { plan: { status: 'not_connected' } } (cerrar sesión no lo hace)
 */
const unauthenticated = () => fail(401, 'Tu sesión ha caducado. Vuelve a iniciar sesión.', 'unauthenticated');
const outdated = () => fail(409, 'Hay una versión nueva de este documento. Revísala y acéptala de nuevo.', 'outdated_version');

export const consentHandlers = [
  http.get(mock('/auth/consents'), async () => {
    await latency(200);
    const email = sessionRecord.get().email;
    if (!email) return unauthenticated();
    return HttpResponse.json({ consents: consentsOf(email) });
  }),

  http.post(mock('/auth/consents'), async ({ request }) => {
    const body = ((await readJson(request)) ?? {}) as { consents?: unknown };
    await latency(450);
    const email = sessionRecord.get().email;
    if (!email) return unauthenticated();
    const items = Array.isArray(body.consents) ? (body.consents as Array<Record<string, unknown>>) : [];
    if (!items.length) return fail(400, 'No hay nada que aceptar.', 'invalid_consent');
    const acceptedAt = new Date().toISOString();
    const accepted: ConsentRecord[] = [];
    for (const item of items) {
      const id = item?.id;
      // El permiso del plan de ChatGPT tiene su propio flujo (POST /auth/chatgpt/plan).
      if (!isConsentId(id) || !TERMS_STEP_CONSENTS.includes(id)) return fail(400, 'Documento desconocido.', 'invalid_consent');
      if (item.version !== CONSENT_DOCUMENTS[id].version) return outdated();
      accepted.push({ id, version: CONSENT_DOCUMENTS[id].version, acceptedAt });
    }
    return HttpResponse.json({ consents: recordConsents(email, accepted) });
  }),

  http.get(mock('/auth/chatgpt/plan'), async () => {
    await latency(200);
    const email = sessionRecord.get().email;
    if (!email) return unauthenticated();
    return HttpResponse.json({ plan: planOf(email) });
  }),

  http.post(mock('/auth/chatgpt/plan'), async ({ request }) => {
    const body = ((await readJson(request)) ?? {}) as { returnTo?: unknown; consentVersion?: unknown };
    await latency(700);
    const email = sessionRecord.get().email;
    if (!email) return unauthenticated();
    if (typeof body.returnTo !== 'string' || !body.returnTo) return fail(400, 'Falta la dirección de vuelta a Uonify.', 'invalid_return_to');
    const version = CONSENT_DOCUMENTS['chatgpt-plan'].version;
    if (body.consentVersion !== version) return outdated();
    // Modo demostración: el permiso de OpenAI se concede sin salir de Uonify.
    const connectedAt = new Date().toISOString();
    const plan = storePlan(email, { status: 'connected', email, connectedAt } satisfies ChatGPTPlanStatus);
    const consents = recordConsents(email, [{ id: 'chatgpt-plan', version, acceptedAt: connectedAt }]);
    return HttpResponse.json({ plan, consents });
  }),

  http.delete(mock('/auth/chatgpt/plan'), async () => {
    await latency(400);
    const email = sessionRecord.get().email;
    if (!email) return unauthenticated();
    return HttpResponse.json({ plan: storePlan(email, { status: 'not_connected' }) });
  }),
];
