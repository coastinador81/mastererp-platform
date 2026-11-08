import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { NOTIFICATIONS_POLL_MS, NOTIFICATIONS_QUERY_OPTIONS } from '../hooks/useNotifications';
import { handlers, inbox } from '../mocks/handlers';
import { DELAYED_ARRIVAL_MS } from '../mocks/seed';
import { emulatePhone, renderBell } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
let listRequests = 0;
server.events.on('request:start', ({ request }) => {
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/notifications') listRequests += 1;
});
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  sessionStorage.clear();
  inbox.reset();
  listRequests = 0;
});

const bell = () => screen.getByRole('button', { name: /^Notificaciones/ });

describe('en el móvil', () => {
  let restore: () => void = () => {};
  beforeEach(() => { restore = emulatePhone(); });
  afterEach(() => restore());

  it('se abre como hoja modal con el foco en la primera notificación', async () => {
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer'));
    await user.click(bell());
    const sheet = await screen.findByRole('dialog', { name: /Notificaciones/ });
    expect(sheet.tagName).toBe('DIALOG');
    expect(sheet).toHaveClass('ntf-sheet');
    expect(bell()).not.toHaveAttribute('aria-controls');
    await waitFor(() => expect(within(sheet).getByRole('link', { name: /Tu vídeo está listo/ })).toHaveFocus());
    expect(within(sheet).getByRole('button', { name: 'Marcar todo como leído' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Preferencias de notificaciones' })).toBeInTheDocument();
  });

  it('la X la cierra y el foco vuelve a la campana', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(bell());
    const sheet = await screen.findByRole('dialog', { name: /Notificaciones/ });
    await user.click(within(sheet).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(bell()).toHaveFocus());
  });

  it('abrir una notificación cierra la hoja y navega', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(bell());
    const sheet = await screen.findByRole('dialog', { name: /Notificaciones/ });
    await user.click(await within(sheet).findByRole('link', { name: /No hemos podido renovar tu plan/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/espacio/configuracion/plan');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('sondeo', () => {
  afterEach(() => vi.useRealTimers());

  it('pregunta cada 60 s solo con la pestaña visible', () => {
    expect(NOTIFICATIONS_POLL_MS).toBe(60_000);
    expect(NOTIFICATIONS_QUERY_OPTIONS).toMatchObject({ refetchInterval: 60_000, refetchIntervalInBackground: false });
  });

  it('a los 60 s vuelve a consultar y anuncia la notificación que ha llegado', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
    renderBell();
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer'));
    expect(listRequests).toBe(1);

    await act(async () => { vi.advanceTimersByTime(NOTIFICATIONS_POLL_MS); });
    await waitFor(() => expect(listRequests).toBe(2));
    expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer');

    await act(async () => { vi.advanceTimersByTime(DELAYED_ARRIVAL_MS); });
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 5 sin leer'));
    expect(listRequests).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('status')).toHaveTextContent('Nueva notificación: Tu modelo 3D está listo');
  });
});
