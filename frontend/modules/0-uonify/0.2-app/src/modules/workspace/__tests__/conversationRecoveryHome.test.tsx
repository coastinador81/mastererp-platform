import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { WorkspaceHome } from '../components/views/WorkspaceHome';
import { sendLivePrompt, useConversationRecovery, useLiveHistory } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi } from '../hooks/uiStore';

const session = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => session.account, useSession: () => ({ status: session.account ? 'ready' : 'signed-out', user: session.account ? { email: session.account } : null }), ConversationActivationPanel: () => null }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: { email: session.account } }) }));
vi.mock('../components/ConversationConnection', () => ({ ConversationConnection: ({ provider }: { provider: string }) => <button>Gestionar {provider}</button> }));
vi.mock('../components/composer/Composer', () => ({ Composer: () => {
  const draft = useComposerStore(state => state.draft);
  return <div><input aria-label="Mensaje" value={draft} readOnly /><button onClick={() => sendLivePrompt(draft)}>Enviar</button></div>;
} }));

function Home() { useLiveHistory(); return <WorkspaceHome />; }
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useConversationRecovery.setState({ recovery: null });
  useComposerStore.setState({ draft: 'Crear mi producto', status: '', dismissedSuggestions: [] });
  useGooglePreferences.setState({ account: session.account, saving: false, data: { models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => vi.restoreAllMocks());

it('muestra controles de recuperación en la bienvenida tras fallar el primer mensaje, aunque desaparezca el hilo provisional', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [] });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { error: 'google_required', message: 'Conecta Google para continuar.', connectionActions: [{ provider: 'cloud', action: 'manage' }] }));
  render(<QueryClientProvider client={new QueryClient()}><Home /></QueryClientProvider>);
  await waitFor(() => { fireEvent.click(screen.getByRole('button', { name: 'Enviar' })); expect(post).toHaveBeenCalledOnce(); });
  expect(await screen.findByRole('region', { name: 'Conexión necesaria' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Gestionar cloud' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Hazlo posible.' })).toBeVisible();
  expect(screen.getByLabelText('Mensaje')).toHaveValue('Crear mi producto');
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  act(() => { window.dispatchEvent(new Event('uonify:identity-changed')); });
  expect(screen.queryByRole('region', { name: 'Conexión necesaria' })).not.toBeInTheDocument();
});
