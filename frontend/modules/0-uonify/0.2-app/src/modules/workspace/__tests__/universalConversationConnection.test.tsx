import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ConversationConnection } from '../components/ConversationConnection';
import type { ConnectionProvider } from '../model/connectionActions';

const identity = vi.hoisted(() => ({ account: 'owner@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account, useSession: () => ({ user: { email: identity.account } }),
  AccountDeletionControl: ({ account }: { account: string }) => <section aria-label="Eliminar cuenta en la conversación">{account}</section> }));
vi.mock('@/modules/amazon', () => ({ AmazonConversationConnection: ({ account }: { account: string }) => <section aria-label="Permisos Amazon">{account}</section> }));
vi.mock('@/modules/cloud', () => ({ GoogleCloudConnection: ({ account }: { account: string }) => <section aria-label="Permisos Cloud">{account}</section> }));
vi.mock('@/modules/drive', () => ({ DriveConnectionSettings: ({ account }: { account: string }) => <section aria-label="Permisos Drive">{account}</section> }));
vi.mock('@/modules/blender', () => ({ BlenderConnectionSettings: ({ account }: { account: string }) => <section aria-label="Permisos Blender">{account}</section> }));

beforeEach(() => { identity.account = 'owner@example.test'; });
afterEach(() => vi.restoreAllMocks());
function mount(provider: ConnectionProvider, account = identity.account) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={cache}><ConversationConnection provider={provider} account={account} /></QueryClientProvider>);
  return { ...view, cache };
}

it.each([
  ['cloud', 'Google Cloud', 'Cloud', '/connections/google-cloud'],
  ['drive', 'Google Drive', 'Drive', '/connections/google-drive'],
  ['blender', 'Blender', 'Blender', '/connections/blender-local'],
] as const)('abre los permisos reales de %s dentro de la tarjeta y restaura el foco', async (provider, name, settings, path) => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ connection: { status: 'disconnected' }, status: 'disconnected' });
  const original = window.location.href;
  mount(provider);
  await screen.findByText('Sin conectar');
  expect(get).toHaveBeenCalledWith(path, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  fireEvent.click(screen.getByRole('button', { name: `Gestionar ${name}` }));
  expect(screen.getByRole('region', { name: `Permisos ${settings}` })).toHaveTextContent(identity.account);
  await waitFor(() => expect(document.activeElement).toHaveClass('conversation-connection-panel'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(screen.getByRole('button', { name: `Gestionar ${name}` })).toHaveFocus());
  expect(window.location.href).toBe(original);
});

it('actualiza el catálogo de IA y servicios cuando cambia el proyecto comprobado de Cloud', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ connection: { status: 'connected', checks: { ready: false } } });
  const { cache } = mount('cloud');
  expect(await screen.findByText('Proyecto por configurar')).toBeInTheDocument();
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  act(() => cache.setQueryData(['google-cloud', identity.account], { connection: { status: 'connected', projectId: 'project-ready', checks: { ready: true } } }));
  await screen.findByText('Conectado');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['uony-options', identity.account] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['uony-services', identity.account] });
});

it('Amazon reutiliza su experiencia aprobada y otra identidad no puede abrir controles', () => {
  const get = vi.spyOn(api, 'get');
  const view = mount('amazon');
  expect(screen.getByRole('region', { name: 'Permisos Amazon' })).toHaveTextContent(identity.account);
  view.unmount();
  mount('drive', 'other@example.test');
  expect(screen.getByRole('status')).toHaveTextContent('Recupera tu sesión');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

it('no interpreta un proveedor desconocido como una ruta ni como una integración disponible', () => {
  const get = vi.spyOn(api, 'get');
  const view = mount('chatgpt' as ConnectionProvider);
  expect(view.container).toBeEmptyDOMElement();
  expect(get).not.toHaveBeenCalled();
});

it('reutiliza la confirmación de cuenta sin navegar ni iniciar borrado al mostrarla', () => {
  const get = vi.spyOn(api, 'get');
  const post = vi.spyOn(api, 'post');
  const view = mount('account');
  expect(screen.getByRole('region', { name: 'Eliminar cuenta en la conversación' })).toHaveTextContent(identity.account);
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  view.unmount();
  mount('account', 'foreign@example.test');
  expect(screen.getByRole('status')).toHaveTextContent('Recupera tu sesión');
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
