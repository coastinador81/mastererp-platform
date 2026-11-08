import { http } from 'msw';
import { uid } from '@/shared/lib';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { DELETION_GRACE_DAYS, deletionConfirmed } from '../model/privacy';
import type { DataExport, PrivacyOverview } from '../model/types';
import { DAY_MS, inDays, nowIso, readJson } from './helpers';
import { accountRecord, brandsStore, connectionsRecord, exportsStore, membersStore, privacyRecord, sessionsStore } from './store';

/**
 * Privacidad (/api/privacy):
 *
 *   GET    /privacy                         → { exports, cookies, deletion, documents }
 *   POST   /privacy/export                  → DataExport ('preparing'; lista en unos segundos, caduca a los 7 días)
 *   GET    /privacy/export/:id/download     → application/json (copia de tus datos) · 404 · 409 not_ready
 *   PUT    /privacy/cookies                 { analytics, marketing } → CookiePreferences
 *   POST   /privacy/deletion                { confirm: 'ELIMINAR' } → { status: 'scheduled', scheduledFor } · 400 confirm_required
 *   DELETE /privacy/deletion                → { status: 'none', scheduledFor: null }
 */
const PREPARE_MS = 4000;
const EXPORT_DAYS = 7;

/** El estado de una exportación avanza con el tiempo, como un trabajo en segundo plano. */
function refreshExport(item: DataExport, now = Date.now()): DataExport {
  if (item.status === 'preparing' && now - Date.parse(item.requestedAt) >= PREPARE_MS) {
    const readyAt = new Date(Date.parse(item.requestedAt) + PREPARE_MS).toISOString();
    return exportsStore.upsert({ ...item, status: 'ready', readyAt, expiresAt: new Date(Date.parse(readyAt) + EXPORT_DAYS * DAY_MS).toISOString(), sizeBytes: exportPayload().length });
  }
  if (item.status === 'ready' && item.expiresAt && now > Date.parse(item.expiresAt)) return exportsStore.upsert({ ...item, status: 'expired' });
  return item;
}

function exportPayload(): string {
  // Solo datos del cliente: nunca secretos ni tokens de terceros.
  const connections = connectionsRecord.get();
  return JSON.stringify({
    exportedAt: nowIso(),
    account: accountRecord.get(),
    team: membersStore.all().map(({ email, role, status }) => ({ email, role, status })),
    brandsGpsr: brandsStore.all(),
    sessions: sessionsStore.all().map(({ browser, os, location, lastActiveAt }) => ({ browser, os, location, lastActiveAt })),
    connections: { chatgpt: connections.chatgpt.status, amazon: connections.amazon.status },
    privacy: privacyRecord.get().cookies,
  }, null, 2);
}

function overview(): PrivacyOverview {
  const state = privacyRecord.get();
  return {
    exports: exportsStore.all().map(item => refreshExport(item)).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt)),
    cookies: state.cookies,
    deletion: state.deletion,
    documents: [
      { id: 'terms', title: 'Condiciones de uso', version: '2026-09-26', acceptedAt: state.acceptedAt, href: '/terminos' },
      { id: 'privacy', title: 'Política de privacidad', version: '2026-09-26', acceptedAt: state.acceptedAt, href: '/privacidad' },
      { id: 'ai-models', title: 'Modelos de IA de terceros', version: '2026-09-26', acceptedAt: state.acceptedAt, href: '/terminos' },
    ],
  };
}

export const privacyHandlers = [
  http.get(mock(ENDPOINTS.privacy), async () => {
    await latency(300);
    return HttpResponse.json(overview());
  }),

  http.post(mock(ENDPOINTS.privacyExport), async () => {
    await latency(500);
    const running = exportsStore.all().map(item => refreshExport(item)).find(item => item.status === 'preparing');
    if (running) return HttpResponse.json(running);
    const item: DataExport = { id: uid('exp'), status: 'preparing', requestedAt: nowIso(), readyAt: null, expiresAt: null, sizeBytes: null };
    return HttpResponse.json(exportsStore.upsert(item), { status: 201 });
  }),

  http.get(mock('/privacy/export/:id/download'), async ({ params }) => {
    await latency(400);
    const stored = exportsStore.get(String(params.id));
    if (!stored) return fail(404, 'Esa copia ya no existe. Pide una nueva.', 'not_found');
    const item = refreshExport(stored);
    if (item.status !== 'ready') return fail(409, item.status === 'expired' ? 'La copia ha caducado. Pide una nueva.' : 'Tu copia aún se está preparando.', 'not_ready');
    return new HttpResponse(exportPayload(), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="uonify-mis-datos.json"' } });
  }),

  http.put(mock(ENDPOINTS.privacyCookies), async ({ request }) => {
    await latency(300);
    const body = await readJson<{ analytics: unknown; marketing: unknown }>(request);
    const next = privacyRecord.update(state => ({
      ...state,
      cookies: { analytics: body.analytics === true, marketing: body.marketing === true, updatedAt: nowIso() },
    }));
    return HttpResponse.json(next.cookies);
  }),

  http.post(mock(ENDPOINTS.privacyDeletion), async ({ request }) => {
    await latency(700);
    const { confirm } = await readJson<{ confirm: string }>(request);
    if (typeof confirm !== 'string' || !deletionConfirmed(confirm)) return fail(400, 'Escribe ELIMINAR para confirmar.', 'confirm_required');
    const next = privacyRecord.update(state => ({ ...state, deletion: { status: 'scheduled', scheduledFor: inDays(DELETION_GRACE_DAYS) } }));
    return HttpResponse.json(next.deletion);
  }),

  http.delete(mock(ENDPOINTS.privacyDeletion), async () => {
    await latency(500);
    const next = privacyRecord.update(state => ({ ...state, deletion: { status: 'none', scheduledFor: null } }));
    return HttpResponse.json(next.deletion);
  }),
];
