import { http } from 'msw';
import { collection } from '@/shared/mocks/db';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import type { AppNotification, MarkAllReadResponse, MarkReadResponse, NotificationsPage } from '../model/types';
import { seedNotifications } from './seed';

/**
 * Simulación del backend de la campana (contrato en api/notifications.ts):
 *
 *   GET  /api/notifications?limit=50
 *     200 → { items: AppNotification[] (la más nueva primero), unread }
 *   POST /api/notifications/:id/read
 *     200 → { id, readAt, unread }        404 → { error: 'not_found', message }
 *   POST /api/notifications/read-all
 *     200 → { updated, readAt, unread: 0 }
 *
 * Una notificación con `createdAt` futuro todavía «no ha llegado»: no se lista ni
 * se puede marcar. Los datos persisten en sessionStorage (@/shared/mocks/db).
 */
export const inbox = collection<AppNotification>('notifications-inbox', () => seedNotifications(Date.now()));

const MAX_LIMIT = 100;

/** Las que ya han llegado, de la más nueva a la más antigua. */
function delivered(now: number): AppNotification[] {
  return inbox
    .all()
    .filter(item => Date.parse(item.createdAt) <= now)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const unreadCount = (now: number) => delivered(now).filter(item => !item.readAt).length;

function readLimit(url: string): number {
  const raw = Number(new URL(url).searchParams.get('limit'));
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_LIMIT) : 50;
}

export const handlers = [
  http.get(mock('/notifications'), async ({ request }) => {
    await latency(300);
    const now = Date.now();
    const page: NotificationsPage = { items: delivered(now).slice(0, readLimit(request.url)), unread: unreadCount(now) };
    return HttpResponse.json(page);
  }),

  http.post(mock('/notifications/read-all'), async () => {
    await latency(250);
    const now = Date.now();
    const readAt = new Date(now).toISOString();
    const pending = delivered(now).filter(item => !item.readAt);
    pending.forEach(item => inbox.patch(item.id, { readAt }));
    const response: MarkAllReadResponse = { updated: pending.length, readAt, unread: 0 };
    return HttpResponse.json(response);
  }),

  http.post(mock('/notifications/:id/read'), async ({ params }) => {
    await latency(200);
    const now = Date.now();
    const id = String(params.id);
    const item = inbox.get(id);
    if (!item || Date.parse(item.createdAt) > now) return fail(404, 'Esta notificación ya no existe.', 'not_found');
    const readAt = item.readAt ?? new Date(now).toISOString();
    if (!item.readAt) inbox.patch(id, { readAt });
    const response: MarkReadResponse = { id, readAt, unread: unreadCount(now) };
    return HttpResponse.json(response);
  }),
];
