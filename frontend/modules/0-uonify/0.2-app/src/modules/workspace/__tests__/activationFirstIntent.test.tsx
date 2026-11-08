import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthDialogs, ConversationActivationGate, type FirstIntentDelivery } from '@/modules/auth';
import { WorkspaceAccessGate } from '@/modules/billing';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { resetStores } from './harness';
import { routes } from '../routes';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import type { GoogleOptions } from '../model/googleOptions';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/Topbar', () => ({ Topbar: () => <header>Uonify</header> }));
vi.mock('../components/navigation/NavDrawer', () => ({ NavDrawer: () => null }));
vi.mock('../components/limit/ChatGptLimitDialog', () => ({ ChatGptLimitDialog: () => null }));
vi.mock('../components/composer/ContextUsage', () => ({ ContextUsage: () => null }));
vi.mock('../hooks/useLimitWatcher', () => ({ useLimitWatcher: () => {}, resetLimitWatcher: () => {} }));

const text = 'Quiero crear la ficha de Basic Mini Bricks desde cero con Uony.';
const reply = 'Vamos a preparar Basic Mini Bricks. ¿Dónde tienes sus documentos?';
const canonical = { requestId: '78c14731-b111-4db6-bdc6-ddc53b17bb86', threadId: 'first_intent_activation', text, model: 'auto', effort: 'medium' as const };
const catalog: GoogleOptions = { models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }],
  efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

beforeEach(() => { resetStores(); window.dispatchEvent(new Event('uonify:identity-changed')); });
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

it.each(['historial', 'modelos'] as const)('terminar el alta entrega la petición una vez sin recargar cuando llega primero %s', async first => {
  const history = deferred(), models = deferred();
  let profileComplete = false;
  let delivery: FirstIntentDelivery | null = null;
  const session = () => ({ authenticated: true, email: 'activation-intent@example.test', account: { provider: 'google' },
    identity: { name: 'Ana García' }, onboardingStage: 'profile', onboarding: { step: 'pending' }, profileComplete, ageConfirmedAdult: true });
  const subscription = { status: 'trialing', cancelAtPeriodEnd: false, interval: 'annual', periodEndsAt: '2099-10-15T00:00:00Z' };
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/auth/session') return session() as never;
    if (path === '/onboarding/setup') return { step: 'complete', firstIntent: text, firstIntentDelivery: delivery,
      drive: { connected: false, deferred: true }, cloud: { connected: true, ready: true, projectId: 'uonify-fixture', projectName: 'Uonify', operation: null }, setupReady: true, aiReady: true,
      activation: { basis: 'trial', endsAt: '2099-10-15T00:00:00Z' } } as never;
    if (path === '/billing/onboarding-offer') return { offer: { version: 'v1', annualCents: 11880, monthlyCents: 990, currency: 'EUR', trialDays: 14, reminderDays: 3 },
      trialUsed: true, embeddedReady: true, access: { status: 'allowed' }, subscription } as never;
    if (path === '/billing/workspace-access') return { status: 'allowed' } as never;
    if (path === '/uony/requests/recent') return { requests: [] } as never;
    if (path === '/uony/options') { await models.promise; return catalog as never; }
    if (path === '/uony/threads') {
      await history.promise;
      return { threads: delivery?.status === 'complete' ? [{ id: canonical.threadId, title: text, service: null, view: 'default',
        messages: [{ role: 'user', text }, { role: 'assistant', text: reply, model: 'Flash', effort: 'medium' }] }] : [] } as never;
    }
    if (path === '/uony/projects') return { projects: [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === '/billing/checkout-status') return { access: { status: 'allowed' }, subscription } as never;
    if (path === '/onboarding/complete') { profileComplete = true; return session() as never; }
    if (path === '/onboarding/first-intent/claim') {
      expect(body).toEqual(catalog.preferences);
      delivery = { ...canonical, status: 'pending', message: '' }; return { delivery } as never;
    }
    if (path === '/uony/messages') {
      expect(body).toEqual(canonical);
      delivery = { ...canonical, status: 'complete', message: '' }; return { reply, model: 'Flash', effort: 'medium' } as never;
    }
    throw new Error(`Operación inesperada: ${path}`);
  });
  const router = createMemoryRouter(routes.map(route => ({ ...route,
    element: <><AuthDialogs /><ConversationActivationGate><WorkspaceAccessGate>{route.element}</WorkspaceAccessGate></ConversationActivationGate></>,
  })), { initialEntries: ['/espacio'] });
  render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
  expect(await screen.findByRole('heading', { name: 'Tu prueba está activa' })).toBeVisible();
  expect(screen.getByText('La retomaremos en tu primera conversación con Uony.')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Continuar con Uony' })).toBeVisible();
  expect(get.mock.calls.some(([path]) => path === '/uony/options' || path === '/uony/threads')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/uony/options')).toBe(true));
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/uony/threads')).toBe(true));
  expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).toHaveFocus();
  expect(document.querySelector('.workspace-column')).toHaveClass('uon-enter-soft');
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/complete')).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim' || path === '/uony/messages')).toHaveLength(0);
  await act(async () => { (first === 'historial' ? history : models).release(); });
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim' || path === '/uony/messages')).toHaveLength(0);
  await act(async () => { (first === 'historial' ? models : history).release(); });
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim')).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
  expect(screen.getAllByText(text, { selector: '.message.user' })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('');
  expect(screen.queryByText('Tu petición está guardada. Estamos preparando la conversación para continuar.')).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/espacio');
});
