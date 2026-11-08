import { api } from '@/shared/api/client';
import { normalizePage } from '../model/inbox';
import type { MarkAllReadResponse, MarkReadResponse, NotificationsPage } from '../model/types';

/**
 * Contrato de la campana con el backend (simulado en mocks/handlers.ts). La sesión
 * va en la cookie; cada cuenta ve solo sus notificaciones.
 *
 *   GET  /api/notifications?limit=50      → { items: AppNotification[], unread }
 *        Las más recientes primero. `unread` cuenta todas las sin leer, aunque no
 *        quepan en la lista. La campana lo consulta cada 60 s.
 *   POST /api/notifications/:id/read      → { id, readAt, unread }   · 404 not_found
 *   POST /api/notifications/read-all      → { updated, readAt, unread: 0 }
 *
 * Errores: { error, message } con `message` en español para la persona.
 */
export const NOTIFICATION_ENDPOINTS = {
  LIST: '/notifications',
  READ: (id: string) => `/notifications/${encodeURIComponent(id)}/read`,
  READ_ALL: '/notifications/read-all',
} as const;

/** Cuántas trae la campana (el backend guarda el historial completo). */
export const NOTIFICATIONS_LIMIT = 50;

export async function fetchNotifications(signal?: AbortSignal): Promise<NotificationsPage> {
  const raw = await api.get<unknown>(NOTIFICATION_ENDPOINTS.LIST, { params: { limit: NOTIFICATIONS_LIMIT }, signal });
  return normalizePage(raw);
}

export function markNotificationRead(id: string): Promise<MarkReadResponse> {
  return api.post<MarkReadResponse>(NOTIFICATION_ENDPOINTS.READ(id));
}

export function markAllNotificationsRead(): Promise<MarkAllReadResponse> {
  return api.post<MarkAllReadResponse>(NOTIFICATION_ENDPOINTS.READ_ALL);
}
