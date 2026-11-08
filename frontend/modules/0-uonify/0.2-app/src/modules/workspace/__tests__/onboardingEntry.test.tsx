import { act, screen, waitFor } from '@testing-library/react';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { renderWorkspace, resetStores } from './harness';
import { prepareOnboardingEntry, takeOnboardingEntry } from '../model/onboardingEntry';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import type { Thread } from '../model/workspaceState';

const identity = vi.hoisted(() => ({ account: 'first-entry@example.test' }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  acknowledgePendingPrompt: vi.fn(), readPendingPrompt: () => '', useSession: () => ({ status: 'ready', user: { email: identity.account } }),
  requirePrompt: async (_text: string, run: () => void) => run(), takePendingPrompt: () => '',
  ConversationActivationPanel: () => null, useConversationActivationOpen: () => false,
}));
vi.mock('../components/Topbar', () => ({ Topbar: () => <header>Uonify</header> }));
vi.mock('../components/navigation/NavDrawer', () => ({ NavDrawer: () => null }));
vi.mock('../components/limit/ChatGptLimitDialog', () => ({ ChatGptLimitDialog: () => null }));
vi.mock('../components/composer/ContextUsage', () => ({ ContextUsage: () => null }));
vi.mock('../hooks/useLimitWatcher', () => ({ useLimitWatcher: () => {}, resetLimitWatcher: () => {} }));

const first: Thread = { id: 'first_intent_original', title: 'Conectar Amazon', service: null, view: 'default',
  messages: [{ role: 'user', text: 'Quiero conectar Amazon' }, { role: 'assistant', text: 'Continuamos con tu conexión de Amazon.' }] };
const other: Thread = { ...first, id: 'another_thread', title: 'Otro trabajo', messages: [{ role: 'assistant', text: 'Otra conversación abierta.' }] };
const catalog = { models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }],
  efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' };

function reads(hasIntent = true) {
  return vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return { firstIntent: hasIntent ? 'Quiero conectar Amazon' : '', firstIntentDelivery: hasIntent ? {
      requestId: 'request-durable', threadId: first.id, text: 'Quiero conectar Amazon', status: 'complete', message: '', model: 'auto', effort: 'medium',
    } : null } as never;
    if (path === '/uony/options') return catalog as never;
    if (path === '/uony/threads') return { threads: [first, other] } as never;
    if (path === '/uony/projects') return { projects: [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
}

beforeEach(() => {
  resetStores(); window.dispatchEvent(new Event('uonify:identity-changed'));
  delete document.documentElement.dataset.reduceMotion;
});
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.reduceMotion; });

it('abre la primera conversación ya entregada una vez, enfoca el espacio y no la vuelve a imponer', async () => {
  reads(); const post = vi.spyOn(api, 'post');
  prepareOnboardingEntry(identity.account);
  const view = renderWorkspace();
  expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).toHaveFocus();
  expect(view.container.querySelector('.workspace-column')).toHaveClass('uon-enter-soft');
  expect(await screen.findByText('Continuamos con tu conexión de Amazon.', { selector: '.message.assistant' })).toBeVisible();
  expect(useWorkspaceStore.getState().activeThreadId).toBe(first.id);
  act(() => useWorkspaceStore.getState().setActiveThread(other.id));
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['uony-threads', identity.account] }); });
  expect(await screen.findByText('Otra conversación abierta.', { selector: '.message.assistant' })).toBeVisible();
  expect(useWorkspaceStore.getState().activeThreadId).toBe(other.id);
  expect(post).not.toHaveBeenCalled();
  view.unmount();
  const again = renderWorkspace();
  await waitFor(() => expect(useWorkspaceStore.getState().activeThreadId).toBe(other.id));
  expect(again.container.querySelector('.workspace-column')).not.toHaveClass('uon-enter-soft');
  expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).not.toHaveFocus();
  expect(post).not.toHaveBeenCalled();
});

it('sin petición previa presenta las ideas existentes sin crear un hilo ni consumir IA', async () => {
  reads(false); const post = vi.spyOn(api, 'post');
  prepareOnboardingEntry(identity.account);
  renderWorkspace();
  expect(await screen.findByRole('heading', { name: 'Hazlo posible.' })).toBeVisible();
  await waitFor(() => expect(useWorkspaceStore.getState().threads).toHaveLength(2));
  expect(useWorkspaceStore.getState().activeThreadId).toBeNull();
  expect(screen.getByLabelText('Ideas para empezar')).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});

it('respeta la preferencia de movimiento reducido conservando el foco y la conversación', async () => {
  reads(); prepareOnboardingEntry(identity.account);
  document.documentElement.dataset.reduceMotion = 'true';
  const view = renderWorkspace();
  expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).toHaveFocus();
  expect(view.container.querySelector('.workspace-column')).not.toHaveClass('uon-enter-soft');
  expect(await screen.findByText('Continuamos con tu conexión de Amazon.', { selector: '.message.assistant' })).toBeVisible();
});

it('la señal no pasa a otra cuenta, no se guarda y se consume una sola vez', () => {
  sessionStorage.clear();
  prepareOnboardingEntry(identity.account);
  expect(takeOnboardingEntry('another@example.test')).toBe(false);
  expect(takeOnboardingEntry(identity.account)).toBe(false);
  prepareOnboardingEntry(identity.account);
  expect(takeOnboardingEntry(identity.account)).toBe(true);
  expect(takeOnboardingEntry(identity.account)).toBe(false);
  expect(sessionStorage.length).toBe(0);
  prepareOnboardingEntry(identity.account);
  window.dispatchEvent(new Event('uonify:identity-changed'));
  expect(takeOnboardingEntry(identity.account)).toBe(false);
});
