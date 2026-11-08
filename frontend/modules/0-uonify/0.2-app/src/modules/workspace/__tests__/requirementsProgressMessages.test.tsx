import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { amazonRequirementsKey, type AmazonRequirements } from '@/modules/catalog';
import { ConversationPanel, type ConversationPanelProps } from '../components/ConversationPanel';
import { useComposerStore } from '../hooks/composerStore';
import { clearConversationFormDrafts } from '../hooks/conversationFormDrafts';
import { prepareProductRequirements, sendLivePrompt } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import type { ConversationFormData } from '../model/conversationForm';
import { conversationFormOf } from '../model/conversationForm';
import type { ChatMessage, Thread } from '../model/workspaceState';
import basicWaiting from './fixtures/basicRequirementsWaiting.json';
import basicRecovered from './fixtures/basicRequirementsRecovered.json';

const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account, useSession: () => ({ user: { email: identity.account } }), ConversationActivationPanel: () => null, useConversationActivationOpen: () => false }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: { email: identity.account } }) }));
vi.mock('../hooks/liveConversation', () => ({ prepareProductRequirements: vi.fn(), sendLivePrompt: vi.fn(), useConversationRecovery: () => null }));
vi.mock('../components/ConversationRecovery', () => ({ ConversationRecovery: () => null }));
vi.mock('../components/composer/Composer', () => ({ Composer: () => {
  const draft = useComposerStore(state => state.draft);
  return <form className="composer" aria-label="Compositor"><textarea aria-label="Escribe a Uony" value={draft}
    onChange={event => useComposerStore.getState().setDraft(event.target.value)} /></form>;
} }));
const product = { sku: 'BMB-DRIVE-PILOTO', name: 'Basic Mini Bricks', revision: 7, bullets: [], customFields: [] };
const form: ConversationFormData = { id: 'reasoning-current', title: 'Revisar documentos e imágenes', fields: [], context: {
  kind: 'product_guide', sku: product.sku, revision: 7, section: 'amazon_requirements', step: 'reasoning' },
  reasoning: { id: 'job-current', status: 'queued', message: 'Estoy reuniendo los datos disponibles.' } };
const changes = [{ product, previousSku: product.sku }];
const progress = (id: string): ChatMessage => ({ role: 'assistant', text: 'Estoy reuniendo los datos disponibles.', model: 'uonify-guide',
  conversationForm: { ...form, id }, productChanges: changes });
const thread = (messages: ChatMessage[], id = 'basic'): Thread => ({ id, title: 'Basic Mini Bricks', service: null, view: 'default', messages });
const questions: ConversationFormData = { id: 'question-next', title: 'Completar los datos para Amazon', submitLabel: 'Guardar y continuar',
  context: { kind: 'product_guide', sku: product.sku, revision: 7, section: 'amazon_requirements', step: 'fields', evaluationId: 'evaluation-next' },
  fields: [{ id: 'weight', label: '¿Cuánto pesa el producto?', type: 'text', required: true }] };
function result(status: 'running' | 'completed' | 'error' = 'running'): AmazonRequirements {
  return { product, evaluation: { state: status === 'completed' ? 'needs_input' : 'reasoning',
    reasoning: { id: 'job-current', status, message: status === 'error' ? 'La revisión no se ha podido completar.' : 'Comprobando tus documentos e imágenes.' },
    fields: [], evaluationId: 'evaluation-next', productType: 'TABLETOP_GAME', marketplaceId: 'A1RKKUPIHCS9HS', referenceAsin: 'B07NPPMZM8',
    schemaVersion: null, schemaChecksum: null, evaluatedAt: null, counts: { missing: 8, invalid: 0, questions: 1 },
    attributes: [], issues: [], message: 'Estado actual de la revisión.', localOnly: true } };
}
function currentQuestion(data: ConversationFormData): AmazonRequirements {
  if (data.context?.kind !== 'product_guide') throw new Error('Se esperaba una pregunta de producto');
  const checked = result('completed');
  checked.product.revision = data.context.revision;
  checked.evaluation.evaluationId = data.context.evaluationId ?? null;
  checked.evaluation.fields = data.fields;
  return checked;
}
let client: QueryClient;
beforeEach(() => {
  identity.account = 'sellerify@example.test'; resetWorkspaceStore(); clearConversationFormDrafts(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Mi siguiente mensaje', focusTick: 0 });
  useWorkspaceStore.setState({ activeThreadId: 'basic', threads: [thread([
    { role: 'user', text: 'Quiero completar mi producto.' }, progress('reasoning-old'),
    { role: 'user', text: 'Retoma la revisión.' }, progress(form.id),
  ])] });
  vi.mocked(prepareProductRequirements).mockReset().mockReturnValue(true); vi.mocked(sendLivePrompt).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });
function View(props: ConversationPanelProps) {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/espacio']}><ConversationPanel {...props} /></MemoryRouter></QueryClientProvider>;
}
const anchor = () => document.querySelector('.conversation-question-anchor') as HTMLElement;
const messages = () => document.getElementById('conversation-messages')!;

it('muestra un único seguimiento sobre el compositor sin respuestas, enlaces ni tarjetas de progreso duplicadas en el historial', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(result()); const post = vi.spyOn(api, 'post'); render(<View />);
  const panel = await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  expect(anchor().children).toHaveLength(1); expect(anchor()).toContainElement(panel);
  expect(panel.closest('.conversation-messages')).toBeNull();
  expect(messages()).not.toHaveTextContent('Estoy reuniendo'); expect(messages()).not.toHaveTextContent('Revisión de los datos');
  expect(screen.queryByRole('button', { name: /Abrir ficha/ })).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledOnce(); expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
it('conserva los controles reales de conexión del progreso sin duplicar su texto ni la tarjeta activa del proveedor', async () => {
  vi.spyOn(api, 'get').mockImplementation(path => Promise.resolve(path === '/connections/google-cloud' ? { connection: { status: 'reauthorize' } } : result('error')));
  const post = vi.spyOn(api, 'post');
  act(() => useWorkspaceStore.setState({ threads: [thread([
    { ...progress('reasoning-old'), connectionActions: [{ provider: 'cloud', action: 'manage' }] },
    { ...progress(form.id), connectionActions: [{ provider: 'cloud', action: 'manage' }] },
  ])] }));
  render(<View />); await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  expect(screen.getAllByRole('region', { name: 'Conexión con Google Cloud en esta conversación' })).toHaveLength(1);
  expect(await screen.findByText('Requiere autorización')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Gestionar Google Cloud' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Ver conexión actual de Google Cloud' })).toBeVisible();
  expect(anchor().children).toHaveLength(1); expect(messages()).not.toHaveTextContent('Estoy reuniendo');
  expect(screen.queryByRole('button', { name: /Abrir ficha/ })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it.each(['running', 'error'] as const)('permite seguir conversando sin perder el seguimiento %s ni crear un segundo indicador', async status => {
  vi.spyOn(api, 'get').mockResolvedValue(result(status)); render(<View />);
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  const draft = screen.getByLabelText('Escribe a Uony'); draft.focus();
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text: 'Mientras tanto, explícame cómo funciona.' });
    setUi({ pendingReply: { threadId: 'basic', label: 'Preparando tu respuesta…' } });
  });
  expect(anchor().children).toHaveLength(1); expect(document.querySelector('.is-thinking')).toBeNull();
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'Podemos seguir hablando mientras se revisa.', model: 'gemini-3.5-flash-lite' });
    setUi({ pendingReply: null });
  });
  expect(screen.getByText('Podemos seguir hablando mientras se revisa.')).toBeVisible();
  expect(screen.getAllByRole('region', { name: 'Revisión de Uony para Amazon' })).toHaveLength(1);
  if (status === 'error') expect(screen.getByRole('button', { name: 'Reintentar con Uony' })).toBeEnabled();
  expect(draft).toHaveFocus(); expect(draft).toHaveValue('Mi siguiente mensaje'); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('al completar retira el progreso y conserva el resultado y la pregunta vigente, solicitada una sola vez', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(result()); render(<View />);
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  const recoveredForm = conversationFormOf(basicRecovered, 'assistant')!;
  vi.mocked(prepareProductRequirements).mockImplementation(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'El estado Nuevo está guardado. Solo falta lo que no he podido resolver.',
      model: 'uonify-guide', productChanges: changes, conversationForm: recoveredForm, conversationFormFresh: true }); return true;
  });
  act(() => client.setQueryData([...amazonRequirementsKey(identity.account, product.sku), ''], result('completed')));
  const invitation = await screen.findByRole('button', { name: 'Responder pregunta' });
  expect(screen.queryByRole('region', { name: 'Revisión de Uony para Amazon' })).not.toBeInTheDocument();
  expect(anchor()).toBeEmptyDOMElement(); expect(screen.getByText(/El estado Nuevo está guardado/)).toBeVisible();
  get.mockResolvedValue(currentQuestion(recoveredForm));
  fireEvent.click(invitation);
  await screen.findByRole('region', { name: 'Pregunta de Uony: Completar los datos para Amazon' });
  expect(anchor().children).toHaveLength(1);
  expect(screen.getByRole('group', { name: '¿Cómo vas a enviar los pedidos?' })).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Amazon enviará los pedidos (Europa)' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Yo enviaré los pedidos' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Abrir ficha · Basic Mini Bricks' })).toHaveLength(1);
  expect(messages()).not.toHaveTextContent('Estoy reuniendo'); expect(prepareProductRequirements).toHaveBeenCalledOnce();
  expect(vi.mocked(prepareProductRequirements).mock.calls[0][1]).not.toHaveProperty('retry');
});
it('un resultado final sin formulario cierra el seguimiento relacionado y mantiene un enlace útil a la ficha', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result()); render(<View />);
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  act(() => useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'Los datos necesarios están completos y guardados.', model: 'uonify-guide', productChanges: changes }));
  expect(anchor()).toBeEmptyDOMElement(); expect(screen.getByText('Los datos necesarios están completos y guardados.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Abrir ficha · Basic Mini Bricks' })).toBeVisible(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('una conversación de otro hilo no recibe el resultado tardío y volver recupera solo una lectura del estado', async () => {
  let finish: (value: AmazonRequirements) => void = () => {};
  const get = vi.spyOn(api, 'get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(result());
  useWorkspaceStore.setState(state => ({ threads: [...state.threads, thread([{ role: 'assistant', text: 'Conversación diferente.' }], 'other')] }));
  render(<View />); await waitFor(() => expect(get).toHaveBeenCalledOnce());
  act(() => useWorkspaceStore.getState().setActiveThread('other')); await act(async () => { finish(result('completed')); });
  expect(anchor()).toBeEmptyDOMElement(); expect(screen.getByText('Conversación diferente.')).toBeVisible(); expect(prepareProductRequirements).not.toHaveBeenCalled();
  act(() => useWorkspaceStore.getState().setActiveThread('basic'));
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' }); await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(anchor().children).toHaveLength(1); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('la renovación del formulario usa un único indicador temporal sobre el compositor y no otra burbuja', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result()); render(<View />);
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text: 'Actualizar preguntas.' });
    setUi({ pendingReply: { threadId: 'basic', label: 'Actualizando las preguntas de tu producto…', requirements: {} } });
  });
  const panel = screen.getByRole('region', { name: 'Preparación de los datos de Amazon' });
  expect(anchor()).toContainElement(panel); expect(anchor().children).toHaveLength(1); expect(document.querySelector('.is-thinking')).toBeNull();
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', progress('reasoning-renewed')); setUi({ pendingReply: null });
  });
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' }); expect(anchor().children).toHaveLength(1);
  expect(messages()).not.toHaveTextContent('Estoy reuniendo'); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('al enviar una respuesta conserva su única tarjeta y borrador; un fallo queda visible sin un segundo indicador', async () => {
  useWorkspaceStore.setState({ threads: [thread([{ role: 'assistant', text: 'Completa este dato.', conversationForm: questions, conversationFormFresh: true }])] });
  vi.spyOn(api, 'get').mockResolvedValue(currentQuestion(questions));
  vi.mocked(sendLivePrompt).mockImplementation(text => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text });
    setUi({ pendingReply: { threadId: 'basic', label: 'Preparando tu respuesta…', requirements: { formId: questions.id } } }); return true;
  });
  render(<View />);
  expect(anchor()).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  fireEvent.change(await screen.findByLabelText('¿Cuánto pesa el producto?'), { target: { value: '100 g' } });
  fireEvent.click(screen.getByRole('button', { name: /Guardar y continuar/ }));
  expect(anchor().children).toHaveLength(1); expect(screen.getByText('Enviando tus respuestas…')).toBeVisible();
  expect(screen.getByRole('button', { name: /Enviando…/ })).toBeDisabled(); expect(document.querySelector('.is-thinking')).toBeNull();
  expect(screen.getByLabelText('¿Cuánto pesa el producto?')).toHaveValue('100 g');
  act(() => {
    useWorkspaceStore.getState().withdrawLastMessage('basic'); setUi({ pendingReply: null });
    vi.mocked(sendLivePrompt).mock.calls[0][1]?.onSettled?.(false, 'No se ha podido guardar. Tu respuesta se conserva.');
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Tu respuesta se conserva.');
  expect(screen.getByLabelText('¿Cuánto pesa el producto?')).toHaveValue('100 g'); expect(useComposerStore.getState().draft).toBe('Mi siguiente mensaje');
});
it('sin compositor visible no crea una tarjeta alternativa y al reabrir recupera el único seguimiento', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result()); const view = render(<View />);
  await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  view.rerender(<View withComposer={false} />); expect(anchor()).toBeEmptyDOMElement();
  expect(messages()).not.toHaveTextContent('Estoy reuniendo'); expect(messages().querySelector('.conversation-question-card')).toBeNull();
  view.rerender(<View />); await screen.findByRole('region', { name: 'Revisión de Uony para Amazon' });
  expect(anchor().children).toHaveLength(1); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('no oculta un texto similar que sea una respuesta real sin metadatos de progreso', () => {
  useWorkspaceStore.setState({ threads: [thread([{ role: 'assistant', text: 'Estoy reuniendo ideas para las instrucciones del juego.', model: 'gemini-3.5-flash-lite' }])] });
  render(<View />); expect(screen.getByText('Estoy reuniendo ideas para las instrucciones del juego.')).toBeVisible();
  // D-PROTECCIÓN: el pie de una respuesta real ahora es la marca «Uony» (ya no el motor). Sigue probando que el mensaje
  // se trata como respuesta real (lleva pie), no como marcador de progreso.
  expect(within(messages()).getByText('Uony')).toBeVisible();
});
it('reproduce el formulario persistido de Basic y sustituye su antiguo estado en cola por el error real sin duplicarlo', async () => {
  // Formulario real del piloto: solo los identificadores del formulario/trabajo se han anonimizado.
  const actualForm = conversationFormOf(basicWaiting, 'assistant')!;
  const state = result('error'); state.product.revision = 11; state.evaluation.reasoning!.id = basicWaiting.reasoning.id;
  const get = vi.spyOn(api, 'get').mockResolvedValue(state); const post = vi.spyOn(api, 'post');
  useWorkspaceStore.setState({ threads: [thread([{ ...progress(actualForm.id), text: basicWaiting.notice, conversationForm: actualForm }])] });
  render(<View />); expect(await screen.findByRole('alert')).toHaveTextContent('La revisión no se ha podido completar.');
  expect(anchor().children).toHaveLength(1); expect(screen.queryByText(basicWaiting.notice)).not.toBeInTheDocument();
  expect(messages()).not.toHaveTextContent('Estoy reuniendo'); expect(screen.queryByText(/77798|77\.798|basic-reasoning-job/)).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledOnce(); expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it('volver al hilo durante un envío mantiene la pregunta y su respuesta, sin otra tarjeta de espera ni reenviar', async () => {
  useWorkspaceStore.setState({ threads: [thread([{ role: 'assistant', text: 'Completa este dato.', conversationForm: questions, conversationFormFresh: true }]),
    thread([{ role: 'assistant', text: 'Otro hilo.' }], 'other')] });
  vi.spyOn(api, 'get').mockResolvedValue(currentQuestion(questions));
  vi.mocked(sendLivePrompt).mockImplementation(text => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text });
    setUi({ pendingReply: { threadId: 'basic', label: 'Preparando tu respuesta…', requirements: { formId: questions.id } } }); return true;
  });
  render(<View />);
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  fireEvent.change(await screen.findByLabelText('¿Cuánto pesa el producto?'), { target: { value: '100 g' } });
  fireEvent.click(screen.getByRole('button', { name: /Guardar y continuar/ }));
  act(() => useWorkspaceStore.getState().setActiveThread('other')); expect(anchor()).toBeEmptyDOMElement();
  act(() => useWorkspaceStore.getState().setActiveThread('basic'));
  expect(await screen.findByLabelText('¿Cuánto pesa el producto?')).toHaveValue('100 g');
  expect(screen.getByRole('button', { name: /Enviando…/ })).toBeDisabled(); expect(anchor().children).toHaveLength(1);
  expect(document.querySelector('.is-thinking')).toBeNull(); expect(sendLivePrompt).toHaveBeenCalledOnce();
});
