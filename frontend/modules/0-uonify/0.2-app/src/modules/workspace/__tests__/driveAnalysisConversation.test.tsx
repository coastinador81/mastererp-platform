import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { conversationFormOf, formResponse } from '../model/conversationForm';
import { materialAnalysisOf } from '../model/materialAnalysis';
import { useLiveHistory, sendLivePrompt, startMaterialReview } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test', useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));
const context = { kind: 'drive_analysis', sku: 'BASIC', revision: 3, section: 'review', analysisId: '11111111-1111-4111-8111-111111111111', proposalIds: ['p1'] };
const form = { id: 'drive-review-1', title: 'Revisa los datos de tus archivos', context, submitLabel: 'Confirmar datos', fields: [
  { id: 'p0', label: 'Marca', type: 'text', required: false, value: 'Uonify', hint: 'Ficha técnica.pdf · Página 1. Deja vacío para descartar.', suggestion: { value: 'Uonify', source: 'Ficha técnica.pdf · Página 1' } },
  { id: 'review_action', label: '¿Cómo quieres continuar?', type: 'select', required: true, closed: true, options: ['Guardar estos datos y continuar', 'Descartar estas propuestas'] },
] };
function History() { useLiveHistory(); return null; }
async function mount() {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 't', title: 'T', service: null, view: 'default', messages: [
    { role: 'assistant', text: 'Tus materiales', materialAnalysis: { sku: 'BASIC', revision: 3 }, conversationForm: form },
    { role: 'user', text: 'Hola', materialAnalysis: { sku: 'BASIC', revision: 3 } },
  ] }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages[0].materialAnalysis).toEqual({ sku: 'BASIC', revision: 3 }));
}
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Mi pregunta sin enviar', status: '' });
  useGooglePreferences.setState({ account: null, data: null, saving: false });
});
afterEach(() => vi.restoreAllMocks());

it('restaura únicamente presentaciones válidas del asistente', () => {
  expect(materialAnalysisOf({ sku: 'BASIC', revision: 3, action: 'delete' }, 'assistant')).toEqual({ sku: 'BASIC', revision: 3 });
  expect(materialAnalysisOf({ sku: 'BASIC', revision: 3 }, 'user')).toBeUndefined();
  expect(materialAnalysisOf({ sku: '../elsewhere', revision: 3 }, 'assistant')).toBeUndefined();
  expect(materialAnalysisOf({ sku: 'BASIC', revision: 0 }, 'assistant')).toBeUndefined();
});

it('recupera tras recarga el trabajo de Drive iniciado sin ficha ni formulario', async () => {
  const jobId = '11111111-1111-4111-8111-111111111111';
  const intakeId = '22222222-2222-4222-8222-222222222222';
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 't', title: 'Drive', service: null,
    view: 'default', messages: [
      { role: 'user', text: 'Analiza esta carpeta', materialAnalysis: { jobId, intakeId } },
      { role: 'assistant', text: 'El análisis está en marcha.', materialAnalysis: { jobId, intakeId } },
    ] }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <History />
  </QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages[1].materialAnalysis)
    .toEqual({ jobId, intakeId }));
  expect(useWorkspaceStore.getState().threads[0]?.messages[0].materialAnalysis).toBeUndefined();
  expect(useWorkspaceStore.getState().threads[0]?.messages[1].conversationForm).toBeUndefined();
});

it('preserva fuentes y sugerencias del formulario, sin conservar acciones no declaradas', () => {
  const parsed = conversationFormOf({ ...form, context: { ...context, execute: true } }, 'assistant')!;
  expect(parsed.context).toEqual(context);
  expect(parsed.fields[0]).toEqual(form.fields[0]);
  expect(parsed.submitLabel).toBe('Confirmar datos');
  expect(formResponse(parsed, { p0: '', review_action: 'Guardar estos datos y continuar' })).toHaveProperty('text');
  expect(formResponse(parsed, { p0: 'Uonify', review_action: 'Publicar' })).toHaveProperty('error');
  for (const change of [{ analysisId: '' }, { section: 'publish' }, { proposalIds: ['../bad'] }, { revision: 0 }]) {
    expect(conversationFormOf({ ...form, context: { ...context, ...change } }, 'assistant')).toBeUndefined();
  }
});

it('conserva la explicación de las evidencias y no preselecciona un valor contradictorio', () => {
  const notice = 'Los valores distintos se revisan una sola vez. Confirmar un dato no acredita la conformidad del producto.';
  const parsed = conversationFormOf({ ...form, notice, fields: [
    { id: 'p0', label: '¿Qué EAN corresponde a tu producto?', type: 'select', required: false, closed: false, options: ['8435833200006', '8435833200013'], hint: 'Las dos fuentes muestran valores distintos.' },
    form.fields[1],
  ] }, 'assistant')!;
  expect(parsed.notice).toBe(notice);
  expect(parsed.fields[0].value).toBeUndefined();
  expect(parsed.fields[0].suggestion).toBeUndefined();
  expect(formResponse(parsed, { p0: '8435833200006', review_action: 'Guardar estos datos y continuar' })).toHaveProperty('text');
  expect(conversationFormOf({ ...form, notice: 'a'.repeat(601) }, 'assistant')?.notice).toBeUndefined();
});

it('inicia la revisión en el mismo hilo sin depender del selector de modelos ni borrar el borrador', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Revisa los datos encontrados.', model: 'uonify-guide', conversationForm: form });
  await mount();
  expect(useWorkspaceStore.getState().threads[0].messages[1].materialAnalysis).toBeUndefined();
  expect(startMaterialReview('BASIC', context.analysisId)).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 't', materialAction: { action: 'review', sku: 'BASIC', analysisId: context.analysisId }, model: 'auto' });
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.conversationForm).toEqual(form);
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.conversationFormFresh).toBe(true);
  expect(useComposerStore.getState().draft).toBe('Mi pregunta sin enviar');
});

it('envía la confirmación persistente y avisa a las dos vistas para refrescar', async () => {
  await mount();
  useWorkspaceStore.getState().withdrawLastMessage('t');
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Datos guardados.', model: 'uonify-guide', materialAnalysis: { sku: 'BASIC', revision: 4 } });
  const refreshed = vi.fn(); window.addEventListener('uonify:product-materials-changed', refreshed);
  const response = { formId: form.id, answers: { p0: 'Uonify', review_action: 'Guardar estos datos y continuar' } };
  expect(sendLivePrompt('Confirmo los datos.', { preserveDraft: true, formResponse: response })).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post.mock.calls[0][1]).toMatchObject({ formResponse: response });
  expect(refreshed).toHaveBeenCalledTimes(1);
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.materialAnalysis).toEqual({ sku: 'BASIC', revision: 4 });
  window.removeEventListener('uonify:product-materials-changed', refreshed);
});
