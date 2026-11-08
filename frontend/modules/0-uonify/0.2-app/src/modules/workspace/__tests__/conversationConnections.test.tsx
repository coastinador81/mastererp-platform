import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConversationMessages } from '../components/ConversationMessages';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import { useConversationRecovery } from '../hooks/liveConversation';
import type { Thread } from '../model/workspaceState';

const session = vi.hoisted(() => ({ account: 'one@example.test', mounts: 0 }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: session.account ? { email: session.account } : null }) }));
vi.mock('../components/ConversationConnection', () => ({
  ConversationConnection: ({ account, provider }: { account: string; provider: string }) => {
    const [instance] = useState(() => ++session.mounts);
    return <div data-testid={`${provider}-controls`} data-instance={instance}>{account}</div>;
  },
}));
const action = [{ provider: 'amazon', action: 'manage' }] as const;
const thread = (id: string): Thread => ({ id, title: id, projectId: 'project-1', service: 'producto', view: 'detail', messages: [
  { role: 'user', text: 'Gestionar Amazon', connectionActions: [...action] },
  { role: 'assistant', text: 'Primera conexión.', connectionActions: [...action] },
  { role: 'assistant', text: 'Conexión actual.', connectionActions: [...action] },
] });

beforeEach(() => {
  resetWorkspaceStore();
  setUi({ pendingReply: null });
  useConversationRecovery.setState({ recovery: null });
  session.account = 'one@example.test'; session.mounts = 0;
  useWorkspaceStore.setState({ threads: [thread('thread-1'), thread('thread-2')], activeThreadId: 'thread-1', activeProjectId: 'project-1' });
  useComposerStore.setState({ draft: 'Mi siguiente mensaje' });
});

function Messages() { return <MemoryRouter initialEntries={['/espacio/producto/SKU-1']}><ConversationMessages centredInService={false} /></MemoryRouter>; }

it('mantiene un único control activo y lleva desde una tarjeta anterior a la actual sin perder contexto ni borrador', () => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  render(<Messages />);
  expect(screen.getAllByTestId('amazon-controls')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Ver conexión actual de Amazon Seller Central' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Ver conexión actual de Amazon Seller Central' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  expect(screen.getByLabelText('Conexión actual de Amazon Seller Central')).toHaveFocus();
  expect(useComposerStore.getState().draft).toBe('Mi siguiente mensaje');
  expect(useWorkspaceStore.getState()).toMatchObject({ activeThreadId: 'thread-1', activeProjectId: 'project-1' });
  expect(useWorkspaceStore.getState().threads[0]).toMatchObject({ service: 'producto', view: 'detail' });
});

it('conserva la última tarjeta de cada proveedor y enlaza Drive a Drive al pedir otras conexiones', () => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  useWorkspaceStore.setState({ threads: [{ ...thread('thread-1'), messages: [
    { role: 'assistant', text: 'Conecta tus materiales', connectionActions: [{ provider: 'drive', action: 'manage' }] },
  ] }] });
  render(<Messages />);
  const firstDrive = screen.getByTestId('drive-controls').getAttribute('data-instance');
  act(() => useWorkspaceStore.getState().pushMessage('thread-1', { role: 'assistant', text: 'Ahora IA y 3D', connectionActions: [
    { provider: 'cloud', action: 'manage' }, { provider: 'blender', action: 'manage' },
  ] }));
  expect(screen.getByTestId('drive-controls').getAttribute('data-instance')).toBe(firstDrive);
  const cloud = screen.getByTestId('cloud-controls').getAttribute('data-instance');
  const blender = screen.getByTestId('blender-controls').getAttribute('data-instance');
  act(() => useWorkspaceStore.getState().pushMessage('thread-1', { role: 'assistant', text: 'Volvamos a Drive', connectionActions: [{ provider: 'drive', action: 'manage' }] }));
  expect(screen.getAllByTestId('drive-controls')).toHaveLength(1);
  expect(screen.getByTestId('drive-controls').getAttribute('data-instance')).not.toBe(firstDrive);
  expect(screen.getByTestId('cloud-controls').getAttribute('data-instance')).toBe(cloud);
  expect(screen.getByTestId('blender-controls').getAttribute('data-instance')).toBe(blender);
  fireEvent.click(screen.getByRole('button', { name: 'Ver conexión actual de Google Drive' }));
  expect(screen.getByLabelText('Conexión actual de Google Drive')).toHaveFocus();
  expect(scroll.mock.instances.at(-1)).toBe(screen.getByLabelText('Conexión actual de Google Drive'));
  expect(useComposerStore.getState().draft).toBe('Mi siguiente mensaje');
});

it('un mensaje puede conservar un proveedor activo y otro histórico sin compartir su destino de foco', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  useWorkspaceStore.setState({ threads: [{ ...thread('thread-1'), messages: [
    { role: 'assistant', text: 'Google', connectionActions: [{ provider: 'drive', action: 'manage' }, { provider: 'cloud', action: 'manage' }] },
    { role: 'assistant', text: 'Drive actualizado', connectionActions: [{ provider: 'drive', action: 'manage' }] },
  ] }] });
  render(<Messages />);
  const cloudParent = screen.getByTestId('cloud-controls').closest('.message');
  expect(cloudParent).toHaveTextContent('Ver conexión actual de Google Drive');
  expect(screen.getAllByTestId('cloud-controls')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Ver conexión actual de Google Drive' }));
  expect(screen.getByLabelText('Conexión actual de Google Drive')).toHaveFocus();
  expect(screen.getByLabelText('Conexión actual de Google Cloud')).not.toHaveFocus();
});

it('desmonta el estado de autorización al cambiar de hilo o cuenta y oculta controles sin sesión', () => {
  const view = render(<Messages />);
  const firstInstance = screen.getByTestId('amazon-controls').getAttribute('data-instance');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-2'));
  const secondInstance = screen.getByTestId('amazon-controls').getAttribute('data-instance');
  expect(secondInstance).not.toBe(firstInstance);
  session.account = 'two@example.test'; view.rerender(<Messages />);
  expect(screen.getByTestId('amazon-controls')).toHaveTextContent('two@example.test');
  expect(screen.getByTestId('amazon-controls').getAttribute('data-instance')).not.toBe(secondInstance);
  session.account = ''; view.rerender(<Messages />);
  expect(screen.queryByTestId('amazon-controls')).not.toBeInTheDocument();
});
