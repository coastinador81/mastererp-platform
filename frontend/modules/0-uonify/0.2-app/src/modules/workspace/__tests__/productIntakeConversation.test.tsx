import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { productIntakeOf } from '../model/productIntake';
import { restoreWorkspace } from '../model/workspaceState';
import { useLiveHistory, sendLivePrompt } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test', useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));
const intake = { id: '11111111-1111-4111-8111-111111111111', revision: 1 };
function History() { useLiveHistory(); return null; }
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Mi petición sin enviar', status: '' });
  useGooglePreferences.setState({ account: 'one@example.test', saving: false, data: { models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => vi.restoreAllMocks());

it('solo restaura referencias válidas del asistente y descarta instrucciones adicionales', () => {
  expect(productIntakeOf({ ...intake, execute: true, sku: 'invented' }, 'assistant')).toEqual(intake);
  for (const invalid of [{ ...intake, id: '../elsewhere' }, { ...intake, revision: 0 }, { ...intake, revision: 1.5 }, { ...intake, revision: '1' }, null]) {
    expect(productIntakeOf(invalid, 'assistant')).toBeUndefined();
  }
  expect(productIntakeOf(intake, 'user')).toBeUndefined();
  const result = restoreWorkspace({ threads: [{ id: 't', title: 'T', messages: [
    { role: 'assistant', text: 'Vamos a aprovechar tus materiales.', productIntake: intake },
    { role: 'user', text: 'Mi mensaje', productIntake: intake },
  ] }] });
  expect(result.threads[0].messages[0].productIntake).toEqual(intake);
  expect(result.threads[0].messages[1].productIntake).toBeUndefined();
});

it('recupera la preparación persistida al consultar el mismo hilo', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 't', title: 'Basic', service: null, view: 'default', messages: [
    { role: 'assistant', text: 'Elige los materiales.', productIntake: intake },
  ] }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages[0].productIntake).toEqual(intake));
  expect(useWorkspaceStore.getState().threads[0].messages[0].conversationFormFresh).toBe(false);
});

it('incorpora una preparación a la respuesta sin inventar un SKU ni borrar otro borrador', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe('one@example.test'));
  vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Podemos empezar por tus documentos.', model: 'gemini-3.5-flash', effort: 'medium', productIntake: { ...intake, action: 'create' } });
  expect(sendLivePrompt('Quiero preparar un producto para Amazon.', { preserveDraft: true })).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  const last = useWorkspaceStore.getState().threads[0].messages.at(-1)!;
  expect(last.productIntake).toEqual(intake);
  expect(last.materialAnalysis).toBeUndefined();
  expect(last.productChanges).toBeUndefined();
  expect(useComposerStore.getState().draft).toBe('Mi petición sin enviar');
});
