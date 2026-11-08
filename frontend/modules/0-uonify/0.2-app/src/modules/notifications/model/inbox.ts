import { isNotificationType } from './catalog';
import { startOfDay } from './time';
import type { AppNotification, NotificationsPage } from './types';

/** Grupo de la lista: «Hoy» y «Anteriores». */
export interface NotificationGroup {
  id: 'today' | 'earlier';
  label: string;
  items: AppNotification[];
}

const byNewest = (a: AppNotification, b: AppNotification) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** Separa las notificaciones en «Hoy» y «Anteriores» (día natural local), de la más nueva a la más antigua. */
export function groupByDay(items: AppNotification[], now: number): NotificationGroup[] {
  const today = startOfDay(now);
  const sorted = [...items].sort(byNewest);
  const groups: NotificationGroup[] = [
    { id: 'today', label: 'Hoy', items: sorted.filter(item => Date.parse(item.createdAt) >= today) },
    { id: 'earlier', label: 'Anteriores', items: sorted.filter(item => Date.parse(item.createdAt) < today) },
  ];
  return groups.filter(group => group.items.length > 0);
}

/** Nombre accesible de la campana, con el número sin leer. */
export function bellLabel(unread: number): string {
  if (unread <= 0) return 'Notificaciones';
  return `Notificaciones: ${unread} sin leer`;
}

/** Texto del contador de la campana (vacío si no hay nada sin leer). */
export function badgeText(unread: number): string {
  if (unread <= 0) return '';
  return unread > 9 ? '9+' : String(unread);
}

/** Solo rutas internas de la aplicación: nada de otros dominios ni esquemas (javascript:…). */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Lee la respuesta del backend sin fiarse de ella: descarta lo que no tiene id,
 * título o fecha válidos, y un tipo desconocido pasa a «announcement».
 */
export function normalizePage(raw: unknown): NotificationsPage {
  const data = (raw ?? {}) as { items?: unknown; unread?: unknown };
  const list = Array.isArray(data.items) ? data.items : [];
  const items = list.flatMap((entry): AppNotification[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = text(item.id, 120);
    const title = text(item.title, 160);
    const createdAt = isoOrNull(item.createdAt);
    if (!id || !title || !createdAt) return [];
    return [{
      id,
      type: isNotificationType(item.type) ? item.type : 'announcement',
      title,
      body: text(item.body, 600),
      createdAt,
      readAt: isoOrNull(item.readAt),
      href: safeHref(item.href),
    }];
  });
  const counted = items.filter(item => !item.readAt).length;
  const unread = typeof data.unread === 'number' && Number.isFinite(data.unread) ? Math.max(Math.floor(data.unread), counted) : counted;
  return { items, unread };
}

/**
 * Marca como leídas en local (actualización optimista) unas notificaciones o
 * todas. Resta del total solo las que de verdad estaban sin leer.
 */
export function markReadLocally(page: NotificationsPage, ids: readonly string[] | 'all', readAt: string): NotificationsPage {
  const targets = ids === 'all' ? null : new Set(ids);
  let changed = 0;
  const items = page.items.map(item => {
    if (item.readAt || (targets && !targets.has(item.id))) return item;
    changed += 1;
    return { ...item, readAt };
  });
  if (ids === 'all') return { items, unread: 0 };
  return { items, unread: Math.max(0, page.unread - changed) };
}

/** Notificaciones sin leer que no estaban en la lista anterior (para anunciarlas). */
export function newUnread(previous: NotificationsPage | undefined, next: NotificationsPage): AppNotification[] {
  if (!previous) return [];
  const known = new Set(previous.items.map(item => item.id));
  return next.items.filter(item => !item.readAt && !known.has(item.id));
}

/** Frase para el lector de pantalla cuando llegan notificaciones nuevas. */
export function arrivalMessage(fresh: AppNotification[]): string {
  if (fresh.length === 0) return '';
  if (fresh.length === 1) return `Nueva notificación: ${fresh[0].title}`;
  return `Tienes ${fresh.length} notificaciones nuevas`;
}
