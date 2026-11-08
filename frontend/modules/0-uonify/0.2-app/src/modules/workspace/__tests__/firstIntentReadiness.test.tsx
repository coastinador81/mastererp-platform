import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useSession, type FirstIntentDelivery } from '@/modules/auth';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { useInitialIntent } from '../hooks/initialIntent';
import { useGoogleOptions } from '../hooks/googlePreferences';
import { useLiveHistory } from '../hooks/liveConversation';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { resetStores } from './harness';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const account = 'handoff-readiness@example.test';
const text = 'Crear Basic Mini Bricks desde cero con Uony.';
const reply = 'Continuamos con tu primera petición.';
const canonical = { requestId: 'f3d4cfc0-b111-4db6-bdc6-ddc53b17bb86', threadId: 'first_intent_readiness', text, model: 'auto', effort: 'medium' as const };
const session = { authenticated: true, email: account, account: { provider: 'google' }, profileComplete: true, ageConfirmedAdult: true };
beforeEach(() => { resetStores(); window.dispatchEvent(new Event('uonify:identity-changed')); });
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });
const mount = (children: React.ReactNode) => render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);

function History() {
  useLiveHistory();
  const count = useWorkspaceStore(state => state.threads.length);
  return <output aria-label="Conversaciones recuperadas">{count}</output>;
}
function SessionRefresh() {
  useSession();
  const client = useQueryClient();
  return <button onClick={() => void client.invalidateQueries({ queryKey: ['auth', 'session'] })}>Actualizar mi sesión</button>;
}

it('el lector montado observa la sesión confirmada y recupera su historial sin recargar el layout', async () => {
  let signedIn = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/auth/session') return (signedIn ? session : { authenticated: false }) as never;
    if (path === '/uony/threads') return { threads: [{ id: 'saved-thread', title: 'Mi conversación', messages: [] }] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  mount(<><SessionRefresh /><History /></>);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/auth/session')).toBe(true));
  expect(get.mock.calls.some(([path]) => path === '/uony/threads')).toBe(false);
  signedIn = true;
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar mi sesión' }));
  await waitFor(() => expect(screen.getByLabelText('Conversaciones recuperadas')).toHaveTextContent('1'));
  expect(get.mock.calls.filter(([path]) => path === '/uony/threads')).toHaveLength(1);
});

function FirstIntentBeforeHistory() {
  const { status, user } = useSession();
  useGoogleOptions();
  useInitialIntent(status === 'ready' ? user?.email ?? null : null);
  const [showHistory, setHistory] = useState(false);
  return <><button onClick={() => setHistory(true)}>Montar el historial de la conversación</button>{showHistory && <History />}</>;
}

it('la primera petición posee la lectura de historial y espera su hidratación para enviar una sola entrega', async () => {
  let delivery: FirstIntentDelivery | null = null;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/auth/session') return session as never;
    if (path === '/onboarding/setup') return { firstIntent: text, firstIntentDelivery: delivery } as never;
    if (path === '/uony/options') return { models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }],
      efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } as never;
    if (path === '/uony/threads') return { threads: delivery?.status === 'complete' ? [{ id: canonical.threadId, title: text,
      messages: [{ role: 'user', text }, { role: 'assistant', text: reply }] }] : [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...canonical, status: 'pending', message: '' }; return { delivery } as never; }
    if (path === '/uony/messages') {
      expect(body).toEqual(canonical);
      delivery = { ...canonical, status: 'complete', message: '' }; return { reply, model: 'Flash', effort: 'medium' } as never;
    }
    throw new Error(`Operación inesperada: ${path}`);
  });
  mount(<FirstIntentBeforeHistory />);
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path === '/uony/threads')).toHaveLength(1));
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Montar el historial de la conversación' }));
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages.at(-1)?.text).toBe(reply));
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim')).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.role === 'user')).toHaveLength(1);
});
