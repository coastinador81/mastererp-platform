import { NOTIFICATION_TYPES, notificationMeta } from '../model/catalog';
import { arrivalMessage, badgeText, bellLabel, groupByDay, markReadLocally, newUnread, normalizePage, safeHref } from '../model/inbox';
import { calendarDaysBetween, formatFullDate, formatWhen } from '../model/time';
import type { AppNotification, NotificationsPage } from '../model/types';
import { DELAYED_ARRIVAL_MS, seedNotifications } from '../mocks/seed';

const at = (year: number, month: number, day: number, hours = 0, minutes = 0) => new Date(year, month, day, hours, minutes).getTime();
const NOW = at(2026, 8, 27, 10, 42); // 27 sept. 2026, 10:42 (hora local)

function item(id: string, createdAt: number, readAt: number | null = null): AppNotification {
  return {
    id,
    type: 'video_ready',
    title: `Aviso ${id}`,
    body: '',
    createdAt: new Date(createdAt).toISOString(),
    readAt: readAt === null ? null : new Date(readAt).toISOString(),
    href: '/espacio',
  };
}

describe('fechas relativas', () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it('hoy: ahora mismo, minutos y horas', () => {
    expect(formatWhen(iso(NOW - 20_000), NOW)).toBe('Ahora mismo');
    expect(formatWhen(iso(NOW - 5 * 60_000), NOW)).toBe('Hace 5 min');
    expect(formatWhen(iso(NOW - 59 * 60_000), NOW)).toBe('Hace 59 min');
    expect(formatWhen(iso(at(2026, 8, 27, 8, 10)), NOW)).toBe('Hace 2 h');
  });

  it('ayer, esta semana, este año y otro año', () => {
    expect(formatWhen(iso(at(2026, 8, 26, 18, 40)), NOW)).toBe('Ayer, 18:40');
    expect(formatWhen(iso(at(2026, 8, 22, 9, 5)), NOW)).toBe('Martes, 9:05');
    expect(formatWhen(iso(at(2026, 8, 14, 12, 0)), NOW)).toBe('14 sept.');
    expect(formatWhen(iso(at(2025, 11, 3, 12, 0)), NOW)).toBe('3 dic. 2025');
  });

  it('una fecha futura (reloj desfasado) cuenta como ahora y una inválida no pinta nada', () => {
    expect(formatWhen(iso(NOW + 90_000), NOW)).toBe('Ahora mismo');
    expect(formatWhen('no-es-fecha', NOW)).toBe('');
  });

  it('fecha completa para el título y días naturales', () => {
    expect(formatFullDate(iso(NOW))).toBe('27 de septiembre de 2026, 10:42');
    expect(calendarDaysBetween(at(2026, 8, 26, 23, 59), at(2026, 8, 27, 0, 1))).toBe(1);
  });
});

describe('lista de la campana', () => {
  it('agrupa en «Hoy» y «Anteriores» de la más nueva a la más antigua', () => {
    const groups = groupByDay([item('a', at(2026, 8, 25, 9)), item('b', at(2026, 8, 27, 0, 5)), item('c', NOW - 60_000), item('d', at(2026, 8, 26, 23, 59))], NOW);
    expect(groups.map(group => group.label)).toEqual(['Hoy', 'Anteriores']);
    expect(groups[0].items.map(entry => entry.id)).toEqual(['c', 'b']);
    expect(groups[1].items.map(entry => entry.id)).toEqual(['d', 'a']);
  });

  it('omite los grupos vacíos', () => {
    expect(groupByDay([item('a', at(2026, 8, 20, 9))], NOW).map(group => group.id)).toEqual(['earlier']);
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('nombre accesible y contador de la campana', () => {
    expect(bellLabel(0)).toBe('Notificaciones');
    expect(bellLabel(1)).toBe('Notificaciones: 1 sin leer');
    expect(bellLabel(12)).toBe('Notificaciones: 12 sin leer');
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(10)).toBe('9+');
  });

  it('solo acepta rutas internas como destino', () => {
    expect(safeHref('/espacio/configuracion/plan')).toBe('/espacio/configuracion/plan');
    expect(safeHref(' /espacio?ticket=T-1 ')).toBe('/espacio?ticket=T-1');
    ['https://otra.web', '//otra.web/x', 'javascript:alert(1)', '/\\otra.web', '', null, 42].forEach(value => expect(safeHref(value)).toBeNull());
  });

  it('cada tipo tiene icono, tono y nombre; uno desconocido se pinta como aviso de Uonify', () => {
    Object.values(NOTIFICATION_TYPES).forEach(meta => {
      expect(meta.icon).toBeTruthy();
      expect(['info', 'success', 'warning', 'error']).toContain(meta.tone);
    });
    expect(notificationMeta('tipo_nuevo')).toBe(NOTIFICATION_TYPES.announcement);
    expect(notificationMeta('payment_failed').tone).toBe('error');
  });
});

describe('respuesta del backend', () => {
  it('descarta entradas rotas, normaliza tipos y destinos, y respeta un total mayor', () => {
    const page = normalizePage({
      unread: 9,
      items: [
        { id: 'ok', type: 'invoice_issued', title: ' Factura ', body: 'Texto', createdAt: '2026-09-27T08:00:00.000Z', readAt: null, href: '/espacio/configuracion/plan' },
        { id: 'raro', type: 'otra_cosa', title: 'Nuevo', createdAt: '2026-09-27T07:00:00.000Z', href: 'https://phishing.test' },
        { id: '', title: 'Sin id', createdAt: '2026-09-27T07:00:00.000Z' },
        { id: 'sin-fecha', title: 'Sin fecha', createdAt: 'ayer' },
        null,
      ],
    });
    expect(page.items.map(entry => entry.id)).toEqual(['ok', 'raro']);
    expect(page.items[0]).toMatchObject({ title: 'Factura', type: 'invoice_issued', href: '/espacio/configuracion/plan' });
    expect(page.items[1]).toMatchObject({ type: 'announcement', href: null, body: '', readAt: null });
    expect(page.unread).toBe(9);
  });

  it('sin total válido cuenta las sin leer de la lista', () => {
    expect(normalizePage({ items: [{ id: 'a', title: 'A', createdAt: '2026-09-27T08:00:00.000Z' }] }).unread).toBe(1);
    expect(normalizePage(null)).toEqual({ items: [], unread: 0 });
  });
});

describe('marcar como leídas en local', () => {
  const page: NotificationsPage = { items: [item('a', NOW - 1000), item('b', NOW - 2000), item('c', NOW - 3000, NOW - 500)], unread: 12 };
  const readAt = new Date(NOW).toISOString();

  it('una: resta solo si estaba sin leer', () => {
    const next = markReadLocally(page, ['a'], readAt);
    expect(next.items.find(entry => entry.id === 'a')?.readAt).toBe(readAt);
    expect(next.unread).toBe(11);
    expect(markReadLocally(page, ['c'], readAt).unread).toBe(12);
    expect(page.items[0].readAt).toBeNull();
  });

  it('todas: el total queda a cero y las ya leídas conservan su fecha', () => {
    const next = markReadLocally(page, 'all', readAt);
    expect(next.unread).toBe(0);
    expect(next.items.every(entry => entry.readAt)).toBe(true);
    expect(next.items[2].readAt).toBe(page.items[2].readAt);
  });

  it('detecta y anuncia las que llegan nuevas', () => {
    const next: NotificationsPage = { items: [item('n1', NOW), ...page.items], unread: 13 };
    expect(newUnread(undefined, next)).toEqual([]);
    expect(newUnread(page, next).map(entry => entry.id)).toEqual(['n1']);
    expect(arrivalMessage(newUnread(page, next))).toBe('Nueva notificación: Aviso n1');
    expect(arrivalMessage([item('x', NOW), item('y', NOW)])).toBe('Tienes 2 notificaciones nuevas');
    expect(arrivalMessage([])).toBe('');
  });
});

describe('datos de ejemplo', () => {
  it('cubren todos los tipos pedidos con destino interno y sin ids repetidos', () => {
    const seed = seedNotifications(NOW);
    expect(new Set(seed.map(entry => entry.id)).size).toBe(seed.length);
    expect(new Set(seed.map(entry => entry.type))).toEqual(new Set([
      'invoice_issued', 'chatgpt_limit_near', 'chatgpt_limit_reached', 'amazon_auth_expiring',
      'video_ready', 'model3d_ready', 'support_replied', 'payment_failed',
    ]));
    seed.forEach(entry => expect(safeHref(entry.href)).toBe(entry.href));
    expect(seed.find(entry => entry.type === 'model3d_ready')?.createdAt).toBe(new Date(NOW + DELAYED_ARRIVAL_MS).toISOString());
  });

  it('siempre hay algo en «Hoy», también de madrugada, sin cambiar el orden', () => {
    const early = at(2026, 8, 27, 0, 5);
    const visible = seedNotifications(early).filter(entry => Date.parse(entry.createdAt) <= early);
    const groups = groupByDay(visible, early);
    expect(groups.map(group => group.label)).toEqual(['Hoy', 'Anteriores']);
    expect(groups[0].items.map(entry => entry.type)).toEqual(['video_ready', 'support_replied', 'chatgpt_limit_near']);
  });

  it('los textos usan euros con formato español y los tokens de Uonify con su valor', () => {
    const seed = seedNotifications(NOW);
    expect(seed.find(entry => entry.type === 'invoice_issued')?.body).toContain('2.000 tokens de Uonify · 20,00 €');
    expect(seed.find(entry => entry.type === 'payment_failed')?.body).toContain('3 de octubre');
    expect(seed.find(entry => entry.type === 'amazon_auth_expiring')?.body).toContain('365 días');
  });
});
