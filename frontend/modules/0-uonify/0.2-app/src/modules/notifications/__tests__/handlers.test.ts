import { setupServer } from 'msw/node';
import { api, ApiError } from '@/shared/api/client';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api/notifications';
import { handlers, inbox } from '../mocks/handlers';
import { DELAYED_ARRIVAL_MS } from '../mocks/seed';

// Sin latencia simulada en las pruebas.
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  sessionStorage.clear();
  inbox.reset();
});
afterEach(() => vi.useRealTimers());

describe('simulación de /api/notifications', () => {
  it('GET lista las que ya han llegado, de la más nueva a la más antigua, con el total sin leer', async () => {
    const page = await fetchNotifications();
    expect(page.items).toHaveLength(7);
    expect(page.unread).toBe(4);
    const times = page.items.map(item => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(page.items.some(item => item.type === 'model3d_ready')).toBe(false);
    expect(page.items[0]).toMatchObject({ type: 'video_ready', href: '/espacio/producto/UON-KIT-01/video', readAt: null });
  });

  it('el modelo 3D llega a los 2 minutos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + DELAYED_ARRIVAL_MS + 1000);
    const page = await fetchNotifications();
    expect(page.items[0]).toMatchObject({ type: 'model3d_ready', href: '/espacio/producto/UON-KIT-01/modelos3d' });
    expect(page.unread).toBe(5);
  });

  it('POST /:id/read marca una y devuelve el nuevo total; repetirlo no cambia nada', async () => {
    const first = await markNotificationRead('ntf-video-ready-0412');
    expect(first).toMatchObject({ id: 'ntf-video-ready-0412', unread: 3 });
    expect(Date.parse(first.readAt)).not.toBeNaN();
    const again = await markNotificationRead('ntf-video-ready-0412');
    expect(again).toEqual(first);
    expect((await fetchNotifications()).unread).toBe(3);
  });

  it('una que no existe o que aún no ha llegado es un 404 legible', async () => {
    for (const id of ['no-existe', 'ntf-model3d-ready-0413']) {
      const error = await markNotificationRead(id).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404, data: { error: 'not_found', message: 'Esta notificación ya no existe.' } });
    }
  });

  it('POST /read-all marca todas las que han llegado (no la que está por llegar)', async () => {
    const result = await markAllNotificationsRead();
    expect(result).toMatchObject({ updated: 4, unread: 0 });
    expect((await fetchNotifications()).items.every(item => item.readAt)).toBe(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + DELAYED_ARRIVAL_MS + 1000);
    expect((await fetchNotifications()).unread).toBe(1);
  });

  it('respeta ?limit= (máximo 100)', async () => {
    const two = await api.get<{ items: unknown[]; unread: number }>('/notifications', { params: { limit: 2 } });
    expect(two.items).toHaveLength(2);
    expect(two.unread).toBe(4);
    const capped = await api.get<{ items: unknown[] }>('/notifications', { params: { limit: 5000 } });
    expect(capped.items).toHaveLength(7);
  });
});
