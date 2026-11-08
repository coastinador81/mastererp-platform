import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { clearAmazonIntent, useAmazonIntent } from '@/modules/amazon';
import { useAuthRouting } from '../hooks/useAuthRouting';
import { openSignInDialog } from '../flows/access';
import { resetNavigation } from '../flows/navigation';

const session = vi.hoisted(() => ({ status: 'ready' }));
vi.mock('../hooks/useSession', () => ({ useSession: () => session }));
vi.mock('../flows/boot', () => ({ bootAuth: vi.fn() }));
vi.mock('../flows/access', () => ({ openSignInDialog: vi.fn() }));
vi.mock('../flows/profile', () => ({ showProfile: vi.fn() }));

function Routing() {
  useAuthRouting();
  const location = useLocation();
  const pending = useAmazonIntent(state => state.pending);
  return <><output aria-label="Ruta">{location.pathname}{location.search}{location.hash}</output><output aria-label="Solicitud">{pending?.id ?? 'ninguna'}</output></>;
}
const tree = (url: string) => <MemoryRouter initialEntries={[url]}><Routing /></MemoryRouter>;
beforeEach(() => { session.status = 'ready'; clearAmazonIntent(); resetNavigation(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); clearAmazonIntent(); resetNavigation(); vi.useRealTimers(); });

it('abre Nexus al recibir el traspaso y no conserva el intent en la URL', async () => {
  render(tree('/?amazon_intent=pending-seller'));
  await waitFor(() => expect(screen.getByLabelText('Ruta')).toHaveTextContent('/espacio/nexus'));
  expect(screen.getByLabelText('Solicitud')).toHaveTextContent('pending-seller');
  expect(screen.getByLabelText('Ruta')).not.toHaveTextContent('amazon_intent');
  expect(JSON.parse(sessionStorage.getItem('uonify.amazon.intent')!)).toEqual({ id: 'pending-seller', createdAt: expect.any(Number) });
});

it('espera al acceso normal sin perder el traspaso ni aceptar la conexión', async () => {
  session.status = 'signed-out';
  const view = render(tree('/?amazon_intent=needs-login&keep=1#section'));
  await waitFor(() => expect(openSignInDialog).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Ruta')).toHaveTextContent('/?keep=1#section');
  expect(screen.getByLabelText('Solicitud')).toHaveTextContent('needs-login');
  session.status = 'ready';
  view.rerender(tree('/'));
  await waitFor(() => expect(screen.getByLabelText('Ruta')).toHaveTextContent('/espacio/nexus'));
  expect(openSignInDialog).toHaveBeenCalledTimes(1);
});

it('la entrada sin Amazon conserva la navegación de acceso anterior', async () => {
  render(tree('/'));
  await waitFor(() => expect(screen.getByLabelText('Ruta').textContent).toBe('/espacio'));
  expect(screen.getByLabelText('Solicitud')).toHaveTextContent('ninguna');
  expect(openSignInDialog).not.toHaveBeenCalled();
});

it('elimina el traspaso al caducar aunque la página siga abierta', async () => {
  vi.useFakeTimers();
  render(tree('/?amazon_intent=will-expire'));
  await act(async () => { await vi.advanceTimersByTimeAsync(600_001); });
  expect(screen.getByLabelText('Solicitud')).toHaveTextContent('ninguna');
  expect(sessionStorage.getItem('uonify.amazon.intent')).toBeNull();
});
