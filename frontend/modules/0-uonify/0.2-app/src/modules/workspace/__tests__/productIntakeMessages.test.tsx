import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConversationMessages } from '../components/ConversationMessages';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import * as live from '../hooks/liveConversation';
import type { Thread } from '../model/workspaceState';

interface IntakeProps { account: string; threadId: string; id: string; isCurrent: () => boolean; onReview: (sku: string, analysisId: string) => boolean }
const captured = vi.hoisted(() => ({ account: 'one@example.test', props: null as IntakeProps | null }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: captured.account ? { email: captured.account } : null }) }));
vi.mock('../components/ConversationFollowUpCards', () => ({ ConversationFollowUpCards: () => null }));
vi.mock('@/modules/drive', async original => ({
  ...await original<typeof import('@/modules/drive')>(),
  IntakeDriveAnalysis: (props: IntakeProps) => {
    captured.props = props;
    return <button onClick={() => props.onReview('BASIC', 'analysis-id')} data-testid="product-intake">{props.account} · {props.threadId}</button>;
  },
}));
const intake = { id: '11111111-1111-4111-8111-111111111111', revision: 1 };
const thread = (id: string): Thread => ({ id, title: id, service: null, view: 'default', messages: [
  { role: 'user', text: 'Mi petición', productIntake: intake },
  { role: 'assistant', text: 'Primera presentación.', productIntake: intake },
  { role: 'assistant', text: 'Retomemos tus materiales.', productIntake: { ...intake, revision: 2 } },
] });
const Messages = () => <MemoryRouter><ConversationMessages centredInService={false} /></MemoryRouter>;
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null }); live.useConversationRecovery.setState({ recovery: null });
  captured.account = 'one@example.test'; captured.props = null;
  useWorkspaceStore.setState({ historyAccount: captured.account,
    threads: [thread('t-one'), thread('t-two')], activeThreadId: 't-one' });
});
afterEach(() => vi.restoreAllMocks());

it('presenta una sola tarjeta vigente y revisa el producto dentro del mismo hilo', () => {
  const review = vi.spyOn(live, 'startMaterialReview').mockReturnValue(true);
  render(<Messages />);
  expect(screen.getAllByTestId('product-intake')).toHaveLength(1);
  expect(captured.props).toMatchObject({ account: 'one@example.test', threadId: 't-one', id: intake.id, revision: 2 });
  expect(captured.props?.isCurrent()).toBe(true);
  fireEvent.click(screen.getByTestId('product-intake'));
  expect(review).toHaveBeenCalledExactlyOnceWith('BASIC', 'analysis-id');
});

it('retira los controles al perder sesión e invalida las acciones del hilo anterior', () => {
  const review = vi.spyOn(live, 'startMaterialReview').mockReturnValue(true);
  const view = render(<Messages />);
  const old = captured.props!;
  act(() => useWorkspaceStore.getState().setActiveThread('t-two'));
  expect(old.isCurrent()).toBe(false);
  expect(old.onReview('BASIC', 'analysis-id')).toBe(false);
  expect(review).not.toHaveBeenCalled();
  expect(screen.getByTestId('product-intake')).toHaveTextContent('t-two');
  captured.account = ''; view.rerender(<Messages />);
  expect(screen.queryByTestId('product-intake')).not.toBeInTheDocument();
});
