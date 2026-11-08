import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import type { AmazonRequirements } from '@/modules/catalog';
import { ConversationForm } from '../components/ConversationForm';
import { conversationFormOf } from '../model/conversationForm';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import { prepareProductRequirements, sendLivePrompt } from '../hooks/liveConversation';
import { clearConversationFormDrafts } from '../hooks/conversationFormDrafts';
import basicRecovered from './fixtures/basicRequirementsRecovered.json';

const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('../hooks/liveConversation', () => ({ prepareProductRequirements: vi.fn(), sendLivePrompt: vi.fn() }));
const form = conversationFormOf(basicRecovered, 'assistant')!;
const product = { sku: 'BMB-DRIVE-PILOTO', name: 'Basic Mini Bricks', revision: 11, bullets: [], customFields: [] };
const current = (): AmazonRequirements => ({ product, evaluation: {
  state: 'needs_input', evaluationId: basicRecovered.context.evaluationId, fields: form.fields,
  reasoning: { id: 'basic-completed-job', status: 'completed', message: 'Revisión completada.' },
  productType: 'TABLETOP_GAME', marketplaceId: 'A1RKKUPIHCS9HS', referenceAsin: 'B07NPPMZM8',
  schemaVersion: 'version-1', schemaChecksum: 'checksum-1', evaluatedAt: '2026-10-15T08:00:00Z',
  counts: { missing: 8, invalid: 0, questions: 16 }, attributes: [], issues: [], message: 'Solo quedan los datos desconocidos.', localOnly: true,
} });
let target: HTMLElement;
beforeEach(() => {
  identity.account = 'sellerify@example.test'; resetWorkspaceStore(); clearConversationFormDrafts(); queryClient.clear();
  setUi({ pendingReply: null }); useComposerStore.setState({ draft: 'Mi siguiente mensaje', status: '' });
  useWorkspaceStore.setState({ activeThreadId: 'basic', threads: [{ id: 'basic', title: 'Basic', service: null, view: 'default',
    messages: [{ role: 'assistant', text: 'Queda esta pregunta.', conversationForm: form }] }] });
  vi.mocked(prepareProductRequirements).mockReset().mockReturnValue(true); vi.mocked(sendLivePrompt).mockReset();
  target = document.createElement('div'); document.body.append(target);
});
afterEach(() => { target.remove(); queryClient.clear(); vi.restoreAllMocks(); });
const view = (autoOpen = false) => <ConversationForm form={form} account="sellerify@example.test" threadId="basic" messageIndex={0}
  active autoOpen={autoOpen} questionTarget={target} />;
const shipping = () => screen.getByRole('radio', { name: 'Yo enviaré los pedidos' });
const open = () => fireEvent.click(screen.getByRole('button', { name: /Responder pregunta|Responder a Uony|Continuar respuesta/ }));
function Delivered({ enabled = true, destination = target }: { enabled?: boolean; destination?: HTMLElement | null }) {
  const thread = useWorkspaceStore(state => state.threads.find(item => item.id === state.activeThreadId));
  const entry = thread?.messages.at(-1);
  return thread && entry?.conversationForm ? <ConversationForm form={entry.conversationForm} account={identity.account} threadId={thread.id}
    messageIndex={thread.messages.length - 1} active autoOpen={entry.conversationFormFresh} questionTarget={destination} questionEnabled={enabled} /> : null;
}
function markFresh() {
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => ({ ...thread,
    messages: thread.messages.map(entry => ({ ...entry, conversationFormFresh: true })),
  })) }));
}

it('cerrar y reabrir el formulario vigente conserva la respuesta y no envía mensajes ni repite preparación', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(current()); const post = vi.spyOn(api, 'post'); render(view(true));
  expect(target).toBeEmptyDOMElement(); open(); await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' });
  fireEvent.click(shipping()); fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  open(); await waitFor(() => expect(shipping()).toBeChecked());
  expect(get).toHaveBeenCalledTimes(2); expect(target.children).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  open(); await waitFor(() => expect(shipping()).toBeChecked());
  expect(get).toHaveBeenCalledTimes(3); expect(prepareProductRequirements).not.toHaveBeenCalled();
  expect(sendLivePrompt).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1); expect(useComposerStore.getState().draft).toBe('Mi siguiente mensaje');
});
it('tras recargar abre el grupo persistido vigente por lectura, aunque el total incluya dieciséis controles', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(current()); const first = render(view());
  open(); expect(await screen.findByRole('group', { name: '¿Cómo vas a enviar los pedidos?' })).toBeVisible();
  first.unmount(); clearConversationFormDrafts(); queryClient.clear(); render(view());
  expect(screen.queryByRole('group', { name: '¿Cómo vas a enviar los pedidos?' })).not.toBeInTheDocument(); open();
  expect(await screen.findByRole('group', { name: '¿Cómo vas a enviar los pedidos?' })).toBeVisible();
  expect(get).toHaveBeenCalledTimes(2); expect(prepareProductRequirements).not.toHaveBeenCalled();
  expect(sendLivePrompt).not.toHaveBeenCalled(); expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
});
it.each(['revision', 'evaluation', 'fields', 'sources'] as const)('conserva la actualización necesaria si cambia %s, sin abrir ni enviar el borrador anterior', async change => {
  const result = structuredClone(current());
  if (change === 'revision') result.product.revision = 12;
  if (change === 'evaluation') result.evaluation.evaluationId = 'new-evaluation';
  if (change === 'fields') result.evaluation.fields = [{ ...form.fields[0], options: ['Otra opción de Amazon'], value: undefined }];
  if (change === 'sources') { result.evaluation.state = 'reasoning'; result.evaluation.reasoning = {
    id: 'changed-sources', status: 'stale', message: 'Un archivo cambió.', materialsPending: true,
  }; }
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce(current()).mockResolvedValue(result); render(view(true));
  open(); await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' });
  fireEvent.click(shipping()); fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' })); open();
  await waitFor(() => expect(prepareProductRequirements).toHaveBeenCalledOnce());
  expect(get).toHaveBeenCalledTimes(2);
  expect(prepareProductRequirements).toHaveBeenCalledWith(product.sku, expect.objectContaining({ onSettled: expect.any(Function) }));
  expect(target).toBeEmptyDOMElement(); expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Ver mi borrador anterior')); expect(screen.getByText('Yo enviaré los pedidos')).toBeVisible();
});
it('un fallo del GET conserva el borrador, muestra el error y no lanza una preparación a ciegas', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce(current()).mockRejectedValueOnce(new Error('No se pudo consultar el estado.')).mockResolvedValue(current());
  const post = vi.spyOn(api, 'post'); render(view(true));
  open(); await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' });
  fireEvent.click(shipping()); fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' })); open();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar el estado.');
  expect(target).toBeEmptyDOMElement(); expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  open(); await waitFor(() => expect(shipping()).toBeChecked()); expect(get).toHaveBeenCalledTimes(3);
});
it.each(['thread', 'account', 'unmount', 'form', 'preparation'] as const)('el doble clic consulta una sola vez y descarta el resultado al cambiar %s', async change => {
  let resolve: (result: AmazonRequirements) => void = () => {};
  const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise(done => { resolve = done; })); const component = render(view());
  const button = screen.getByRole('button', { name: 'Responder pregunta' }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(get).toHaveBeenCalledOnce()); expect(button).toBeDisabled();
  if (change === 'thread') act(() => useWorkspaceStore.setState({ activeThreadId: 'other' }));
  if (change === 'account') act(() => { identity.account = 'other@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  if (change === 'unmount') component.unmount();
  if (change === 'form') act(() => useWorkspaceStore.getState().pushMessage('basic', {
    role: 'assistant', text: 'Estas son las preguntas actuales.', conversationForm: { ...form, id: 'new-current-form' },
  }));
  if (change === 'preparation') act(() => setUi({ pendingReply: { threadId: 'basic', label: 'Actualizando preguntas…', requirements: {} } }));
  const outdated = current(); outdated.product = { ...product, revision: 12 };
  await act(async () => resolve(outdated));
  expect(target).toBeEmptyDOMElement(); expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(sendLivePrompt).not.toHaveBeenCalled();
});
it('consume la entrega fresca una sola vez en StrictMode y espera el clic antes de comprobar la pregunta', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(current()); markFresh();
  const component = render(<StrictMode><Delivered destination={null} /></StrictMode>);
  expect(useWorkspaceStore.getState().threads[0].messages[0].conversationFormFresh).toBe(false);
  expect(target).toBeEmptyDOMElement(); component.rerender(<StrictMode><Delivered /></StrictMode>);
  expect(screen.getByRole('button', { name: 'Responder pregunta' })).toBeVisible();
  expect(target).toBeEmptyDOMElement(); expect(get).not.toHaveBeenCalled();
  component.unmount(); render(<StrictMode><Delivered /></StrictMode>);
  expect(target).toBeEmptyDOMElement(); expect(get).not.toHaveBeenCalled();
  open(); expect(await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' })).toBeVisible();
  expect(get).toHaveBeenCalledOnce(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});
it.each(['thread', 'module', 'anchor', 'remount'] as const)('la entrega consumida no reaparece por su borrador al volver de %s; comprueba los cambios antes de retomar', async change => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(current()); markFresh(); const component = render(<Delivered />);
  expect(target).toBeEmptyDOMElement(); open(); await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' });
  fireEvent.click(shipping()); fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  expect(get).toHaveBeenCalledOnce();
  if (change === 'thread') {
    act(() => useWorkspaceStore.getState().setActiveThread('other'));
    act(() => useWorkspaceStore.getState().setActiveThread('basic'));
  }
  if (change === 'module') { component.rerender(<Delivered enabled={false} />); component.rerender(<Delivered />); }
  if (change === 'anchor') {
    const replacement = document.createElement('div'); document.body.append(replacement);
    component.rerender(<Delivered destination={replacement} />); expect(replacement).toBeEmptyDOMElement();
    component.rerender(<Delivered />); replacement.remove();
  }
  if (change === 'remount') { component.unmount(); render(<Delivered />); }
  expect(target).toBeEmptyDOMElement(); expect(get).toHaveBeenCalledOnce();
  const changed = current(); changed.product = { ...product, revision: 12 }; get.mockResolvedValue(changed); open();
  await waitFor(() => expect(prepareProductRequirements).toHaveBeenCalledOnce());
  expect(get).toHaveBeenCalledTimes(2); expect(target).toBeEmptyDOMElement();
  fireEvent.click(screen.getByText('Ver mi borrador anterior')); expect(screen.getByText('Yo enviaré los pedidos')).toBeVisible();
});
it('una entrega recibida con el dock oculto no conserva permiso para abrirse después', () => {
  const get = vi.spyOn(api, 'get'); markFresh(); const component = render(<Delivered enabled={false} />);
  component.rerender(<Delivered />); expect(target).toBeEmptyDOMElement(); expect(get).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads[0].messages[0].conversationFormFresh).toBe(false);
});
it.each(['module', 'anchor'] as const)('un GET tardío no restaura la apertura cuando cambia %s y se vuelve al destino anterior', async change => {
  let finish: (result: AmazonRequirements) => void = () => {};
  const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const component = render(<Delivered />); open(); await waitFor(() => expect(get).toHaveBeenCalledOnce());
  if (change === 'module') { component.rerender(<Delivered enabled={false} />); component.rerender(<Delivered />); }
  if (change === 'anchor') {
    const replacement = document.createElement('div'); document.body.append(replacement);
    component.rerender(<Delivered destination={replacement} />); component.rerender(<Delivered />); replacement.remove();
  }
  await act(async () => finish(current()));
  expect(target).toBeEmptyDOMElement(); expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(sendLivePrompt).not.toHaveBeenCalled();
});
it('una apertura comprobada pierde el permiso al ocultar el dock y exige un GET nuevo al volver', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(current()); const component = render(<Delivered />);
  open(); await screen.findByRole('radio', { name: 'Yo enviaré los pedidos' }); fireEvent.click(shipping());
  component.rerender(<Delivered enabled={false} />); component.rerender(<Delivered />);
  expect(target).toBeEmptyDOMElement(); expect(get).toHaveBeenCalledOnce();
  open(); await waitFor(() => expect(shipping()).toBeChecked()); expect(get).toHaveBeenCalledTimes(2);
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});
