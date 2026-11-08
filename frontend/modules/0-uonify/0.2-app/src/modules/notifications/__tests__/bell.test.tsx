import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { fail, HttpResponse, mock } from '@/shared/mocks/utils';
import { handlers, inbox } from '../mocks/handlers';
import { renderBell } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  sessionStorage.clear();
  inbox.reset();
});

const bell = () => screen.getByRole('button', { name: /^Notificaciones/ });

async function openPanel() {
  const user = userEvent.setup();
  const view = renderBell();
  await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer'));
  await user.click(bell());
  const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
  await within(panel).findByRole('heading', { name: 'Hoy' });
  return { user, panel, ...view };
}

describe('<NotificationsBell/>', () => {
  it('muestra el contador de no leídas con un nombre accesible', async () => {
    renderBell();
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer'));
    expect(screen.getByTestId('notifications-count')).toHaveTextContent('4');
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
  });

  it('abre el panel con el foco dentro y agrupa en «Hoy» y «Anteriores»', async () => {
    const { panel } = await openPanel();
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(bell()).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveFocus();
    const today = within(panel).getByRole('region', { name: 'Hoy' });
    const earlier = within(panel).getByRole('region', { name: 'Anteriores' });
    expect(within(today).getAllByRole('listitem')).toHaveLength(3);
    expect(within(earlier).getAllByRole('listitem')).toHaveLength(4);
    const video = within(today).getByRole('link', { name: /Tu vídeo está listo/ });
    expect(video).toHaveAccessibleName('Sin leer. Vídeo: Tu vídeo está listo');
    expect(video).toHaveAccessibleDescription(expect.stringMatching(/^«Make It Possible · anuncio 16:9» \(15 s\) ya está en la biblioteca de Vídeo del producto\. (Hace \d+ (min|h)|Ahora mismo)$/));
    expect(video).toHaveAttribute('href', '/espacio/producto/UON-KIT-01/video');
    expect(within(earlier).getByRole('link', { name: /Factura F-\d{4}-0318 emitida/ })).toHaveAttribute('href', '/espacio/configuracion/plan');
    expect(within(earlier).getByRole('link', { name: /autorización de Amazon/ })).toHaveAttribute('href', '/espacio/configuracion/conexiones');
    expect(within(today).getAllByText(/^(Hace \d+ (min|h)|Ahora mismo)$/, { selector: 'time' })).toHaveLength(3);
    expect(within(earlier).getByText(/^Ayer, 18:40$/, { selector: 'time' })).toBeInTheDocument();
  });

  it('marca una como leída con el punto, sin salir del panel, y el foco pasa a la notificación', async () => {
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: 'Marcar como leída: Tu vídeo está listo' }));
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 3 sin leer'));
    const video = within(panel).getByRole('link', { name: /Tu vídeo está listo/ });
    expect(video).toHaveFocus();
    expect(video).not.toHaveAccessibleName(expect.stringMatching(/^Sin leer/));
    expect(within(panel).queryByRole('button', { name: 'Marcar como leída: Tu vídeo está listo' })).not.toBeInTheDocument();
    expect(inbox.get('ntf-video-ready-0412')?.readAt).toBeTruthy();
  });

  it('marca todas como leídas, lo anuncia y quita el contador', async () => {
    const { user, panel } = await openPanel();
    const markAll = within(panel).getByRole('button', { name: 'Marcar todo como leído' });
    await user.click(markAll);
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones'));
    expect(screen.queryByTestId('notifications-count')).not.toBeInTheDocument();
    expect(markAll).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Todas las notificaciones están marcadas como leídas');
    expect(within(panel).queryAllByRole('button', { name: /^Marcar como leída/ })).toHaveLength(0);
    await waitFor(() => expect(inbox.all().filter(item => Date.parse(item.createdAt) <= Date.now()).every(item => item.readAt)).toBe(true));
  });

  it('abrir una notificación la marca como leída, cierra el panel y lleva a su destino', async () => {
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('link', { name: /Soporte ha respondido/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/espacio/configuracion/ayuda?ticket=T-10482');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notificaciones: 3 sin leer'));
  });

  it('lleva a las preferencias de notificaciones de la cuenta', async () => {
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('link', { name: 'Preferencias de notificaciones' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/espacio/configuracion/cuenta#notificaciones');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Escape cierra y devuelve el foco a la campana', async () => {
    const { user } = await openPanel();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bell()).toHaveFocus();
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
  });

  it('pulsar fuera o salir con Tab lo cierra', async () => {
    const { user } = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Fuera' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    within(panel).getByRole('link', { name: 'Preferencias de notificaciones' }).focus();
    await user.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('estado vacío', async () => {
    server.use(http.get(mock('/notifications'), () => HttpResponse.json({ items: [], unread: 0 })));
    const user = userEvent.setup();
    renderBell();
    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    expect(await within(panel).findByText('No tienes notificaciones')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Marcar todo como leído' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Preferencias de notificaciones' })).toBeInTheDocument();
  });

  it('si falla la carga, lo dice y permite reintentar', async () => {
    let broken = true;
    server.use(http.get(mock('/notifications'), () => (broken ? fail(500, 'Servicio no disponible') : undefined)));
    const user = userEvent.setup();
    renderBell();
    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('No hemos podido cargar tus notificaciones.');
    broken = false;
    await user.click(within(panel).getByRole('button', { name: 'Reintentar' }));
    expect(await within(panel).findByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
    expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer');
  });

  it('si el backend no puede marcarla, se deshace el cambio', async () => {
    server.use(http.post(mock('/notifications/:id/read'), () => fail(500, 'No se ha podido guardar.')));
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: 'Marcar como leída: Tu vídeo está listo' }));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Marcar como leída: Tu vídeo está listo' })).toBeInTheDocument());
    expect(bell()).toHaveAccessibleName('Notificaciones: 4 sin leer');
    expect(inbox.get('ntf-video-ready-0412')?.readAt).toBeNull();
  });
});
