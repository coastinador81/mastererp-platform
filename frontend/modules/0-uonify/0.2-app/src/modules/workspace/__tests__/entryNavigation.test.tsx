import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { WorkspaceLayout } from '../components/WorkspaceLayout';

vi.hoisted(() => window.history.replaceState({}, '', '/espacio/nexus'));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../hooks/liveConversation', () => ({ useLiveHistory: () => {} }));
vi.mock('../hooks/useLimitWatcher', () => ({ useLimitWatcher: () => {} }));
vi.mock('../hooks/useShellEffects', () => ({
  useChatSheetReset: () => {}, useEscapeOrder: () => {}, useNavExpandedSync: () => {},
  useScreenMotion: () => {}, useWindowResizeTick: () => {}, usePendingPrompt: () => {},
}));
vi.mock('../components/ConversationPanel', () => ({ ConversationPanel: () => null }));
vi.mock('../components/navigation/NavDrawer', () => ({ NavDrawer: () => null }));
vi.mock('../components/limit/ChatGptLimitDialog', () => ({ ChatGptLimitDialog: () => null }));
vi.mock('../components/LiveServiceView', () => ({ LiveServiceView: () => <h1>Nexus abierto</h1> }));
vi.mock('../components/Topbar', () => ({ Topbar: () => {
  const navigate = useNavigate();
  return <button onClick={() => void navigate('/espacio/nexus')}>Abrir Nexus</button>;
} }));

it('permite volver a Nexus después de que una recarga haya redirigido al chat', async () => {
  render(<MemoryRouter initialEntries={['/espacio/nexus']}><WorkspaceLayout /></MemoryRouter>);
  const open = await screen.findByRole('button', { name: 'Abrir Nexus' });
  expect(screen.queryByRole('heading', { name: 'Nexus abierto' })).not.toBeInTheDocument();
  fireEvent.click(open);
  expect(await screen.findByRole('heading', { name: 'Nexus abierto' })).toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});
