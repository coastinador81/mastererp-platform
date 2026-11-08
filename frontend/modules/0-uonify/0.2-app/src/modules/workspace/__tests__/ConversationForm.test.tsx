import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ConversationForm } from '../components/ConversationForm';
import { ConversationQuestion } from '../components/ConversationQuestion';
import { prepareProductRequirements, sendLivePrompt, startMaterialReview } from '../hooks/liveConversation';
import { useWorkspaceStore, resetWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import type { ConversationFormData } from '../model/conversationForm';
import { clearConversationFormDrafts } from '../hooks/conversationFormDrafts';

let questionTarget: HTMLElement;
const panelName = 'Pregunta de Uony: Tu producto';
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('../hooks/liveConversation', () => ({ sendLivePrompt: vi.fn(), startMaterialReview: vi.fn(), prepareProductRequirements: vi.fn() }));
const form: ConversationFormData = { id: 'form-1', title: 'Tu producto', fields: [
  { id: 'name', label: 'Nombre', type: 'text', required: true },
  { id: 'source', label: 'Recursos', type: 'select', required: true, options: ['Desde cero', 'Tengo archivos'] },
] };
beforeEach(() => {
  questionTarget = document.createElement('div');
  questionTarget.className = 'conversation-question-anchor';
  document.body.append(questionTarget);
  vi.mocked(sendLivePrompt).mockReset(); vi.mocked(startMaterialReview).mockReset(); identity.account = 'one@example.test';
  vi.mocked(prepareProductRequirements).mockReset();
  clearConversationFormDrafts(); resetWorkspaceStore(); setUi({ pendingReply: null });
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'Hilo', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Cuéntame', conversationForm: form }] }] });
  useComposerStore.setState({ draft: 'Mi borrador', status: '' });
});
afterEach(() => { questionTarget.remove(); queryClient.clear(); vi.restoreAllMocks(); });
function View({ active, autoOpen = true, target = questionTarget }: { active?: boolean; autoOpen?: boolean; target?: HTMLElement | null }) {
  const last = useWorkspaceStore(state => state.threads.find(thread => thread.id === 't')?.messages.length === 1);
  return <ConversationForm form={form} account="one@example.test" threadId="t" messageIndex={0} active={active ?? last} autoOpen={autoOpen} questionTarget={target} />;
}
function openQuestion() { fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' })); }
function firstAnswer() {
  openQuestion();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juego de madera' } });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
}
function choose() { fireEvent.click(screen.getByRole('radio', { name: 'Desde cero' })); }

it('la elección inicial ofrece una invitación discreta y solo envía tras confirmar', () => {
  const source: ConversationFormData = { id: 'source-1', title: 'Empezar producto', presentation: 'inline_choice', fields: [
    { id: 'product_sources', label: '¿Tienes fotos o documentos del producto, o partimos desde cero?', type: 'select', required: true,
      options: ['Tengo una carpeta en Drive', 'Partimos desde cero'] },
  ] };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'Producto', service: null, view: 'default', messages: [
    { role: 'assistant', text: '¿Tienes fotos o documentos del producto, o partimos desde cero?', conversationForm: source },
  ] }] });
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  const { container } = render(<div className="conversation-messages"><div className="message assistant has-form">
    ¿Tienes fotos o documentos del producto, o partimos desde cero?
    <ConversationForm form={source} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />
  </div></div>);
  expect(screen.getByRole('button', { name: 'Responder pregunta' }).closest('.conversation-messages')).not.toBeNull();
  expect(questionTarget).toBeEmptyDOMElement();
  expect(screen.queryByRole('region', { name: /Pregunta de Uony/ })).not.toBeInTheDocument();
  expect(container.querySelector('.uony-question-panel')).toBeNull();
  openQuestion();
  const choice = screen.getByRole('group', { name: source.fields[0].label });
  expect(questionTarget).toContainElement(choice);
  fireEvent.click(screen.getByRole('radio', { name: 'Tengo una carpeta en Drive' }));
  expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  expect(sendLivePrompt).toHaveBeenCalledExactlyOnceWith('Tengo una carpeta en Drive', expect.objectContaining({ preserveDraft: true }));
  expect(vi.mocked(sendLivePrompt).mock.calls[0][1]).not.toHaveProperty('formResponse');
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
});

it('permite escribir una alternativa en la elección inicial sin enviarla al teclear', () => {
  const source: ConversationFormData = { id: 'source-free', title: 'Empezar producto', presentation: 'inline_choice', fields: [
    { id: 'product_sources', label: '¿Con qué materiales empezamos?', type: 'select', required: true,
      options: ['Tengo una carpeta en Drive', 'Partimos desde cero'] },
  ] };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'Producto', service: null, view: 'default', messages: [
    { role: 'assistant', text: '¿Con qué materiales empezamos?', conversationForm: source },
  ] }] });
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  render(<ConversationForm form={source} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  openQuestion();
  fireEvent.change(screen.getByLabelText('O escribe tu respuesta'), { target: { value: 'Tengo fotos en mi ordenador' } });
  expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  expect(sendLivePrompt).toHaveBeenCalledExactlyOnceWith('Tengo fotos en mi ordenador', expect.objectContaining({ preserveDraft: true }));
});

it('enfoca la respuesta cuando la nueva pregunta se habilita después de terminar la petición anterior', () => {
  const change = vi.fn();
  const view = render(<><button type="button">Cancelar</button><ConversationQuestion field={form.fields[0]} value="" custom={false} disabled focusRequested change={change} /></>);
  screen.getByRole('button', { name: 'Cancelar' }).focus();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  expect(screen.getByLabelText('Nombre')).toBeDisabled();
  view.rerender(<><button type="button">Cancelar</button><ConversationQuestion field={form.fields[0]} value="" custom={false} disabled={false} focusRequested change={change} /></>);
  expect(screen.getByLabelText('Nombre')).toBeEnabled();
  expect(screen.getByLabelText('Nombre')).toHaveFocus();
});

it('una selección cerrada de Amazon no ofrece respuesta libre y las listas largas usan selector', () => {
  const field = { id: 'unit', label: 'Unidad admitida', type: 'select' as const, required: true, closed: true, options: Array.from({ length: 12 }, (_, index) => `Unidad ${index}`), hint: 'Solo opciones de Amazon.' };
  const change = vi.fn();
  render(<ConversationQuestion field={field} value="" custom={false} disabled={false} change={change} />);
  expect(screen.getByRole('combobox', { name: 'Unidad admitida' })).toBeVisible();
  expect(screen.queryByPlaceholderText('O escribe tu propia respuesta…')).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Unidad 2' } });
  expect(change).toHaveBeenCalledWith('Unidad 2');
});

it('muestra antes y después y solo confirma Amazon después de elegir y pulsar el botón', () => {
  const review: ConversationFormData = { id: 'review-1', title: 'Revisar incidencia', context: { kind: 'product_incident', incidentId: '11111111-1111-4111-8111-111111111111', revision: 2, step: 'review' },
    fields: [{ id: 'action', label: '¿Autorizas el envío?', type: 'select', required: true, closed: true, options: ['Enviar corrección a Amazon', 'Dejar pendiente'] }],
    review: [{ label: 'Peso', before: '0.2 kilogramos', after: '0.3 kilogramos' }], submitLabel: 'Confirmar elección' };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'T', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Revisa', conversationForm: review }] }] });
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  render(<ConversationForm form={review} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  expect(screen.getByText('0.2 kilogramos')).toBeVisible();
  expect(screen.getByText('0.3 kilogramos')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'Enviar corrección a Amazon' }));
  expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar elección' }));
  expect(sendLivePrompt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ preserveDraft: true, formResponse: { formId: 'review-1', answers: { action: 'Enviar corrección a Amazon' } } }));
  expect(sendLivePrompt).toHaveBeenCalledOnce();
});

it('mantiene el foco del chat hasta abrir la pregunta y muestra el panel sin modal ni bloqueo', () => {
  render(<input aria-label="Mensaje del chat" defaultValue="Mi otro borrador" />);
  const composer = screen.getByLabelText('Mensaje del chat');
  composer.focus();
  const overflow = document.body.style.overflow;
  render(<View />);
  expect(questionTarget).toBeEmptyDOMElement();
  expect(composer).toHaveFocus();
  expect(composer).toBeEnabled();
  expect(composer).toHaveValue('Mi otro borrador');
  openQuestion();
  const panel = screen.getByRole('region', { name: panelName });
  expect(questionTarget).toContainElement(panel);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('[inert], [aria-modal="true"]')).toBeNull();
  expect(document.body.style.overflow).toBe(overflow);
  expect(screen.getByLabelText('Nombre')).toHaveFocus();
  expect(screen.queryByRole('region', { name: 'Preguntas: Tu producto' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Completa «Nombre»');
  expect(screen.getByLabelText('Pregunta 1 de 2')).toBeVisible();
  expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('retoma un formulario antiguo por los requisitos de Amazon sin mostrar ni enviar sus preguntas', () => {
  const review: ConversationFormData = { id: 'drive-conflict', title: 'Datos de Basic Mini Bricks',
    context: { kind: 'drive_analysis', sku: 'BASIC', revision: 2, section: 'review', analysisId: '11111111-1111-4111-8111-111111111111', proposalIds: ['ean1'] },
    fields: [{ id: 'p0', label: 'Bloques por servicio · diseño nominal', type: 'text', required: false, value: '6 unidades' }],
  };
  vi.mocked(startMaterialReview).mockReturnValue(true);
  render(<ConversationForm form={review} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  expect(screen.queryByText('Bloques por servicio · diseño nominal')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(startMaterialReview).toHaveBeenCalledWith('BASIC', '11111111-1111-4111-8111-111111111111');
  expect(sendLivePrompt).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
});

it('oculta la aclaración y la muestra bajo demanda sin tapar la pregunta ni sus errores', () => {
  const noticeForm = { ...form, notice: 'Responder no publica tu producto.' };
  render(<ConversationForm form={noticeForm} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  openQuestion();
  expect(screen.getByText(noticeForm.notice)).not.toBeVisible();
  expect(screen.getByLabelText('Nombre')).toBeVisible();
  const toggle = screen.getByRole('button', { name: 'Más información' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByText(noticeForm.notice)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar: más información' }));
  expect(screen.getByText(noticeForm.notice)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByRole('alert')).toBeVisible();
});

it('muestra fuente legible sin rutas ni versiones, conservando el valor al usar la sugerencia', () => {
  const change = vi.fn();
  const technical = 'datos.json · $.fields[15].value · versión a6770d175fb34c. «6»';
  const field = { ...form.fields[0], label: '¿Cuántas piezas incluye?', hint: 'Indica el número de piezas.', suggestion: { value: '6 unidades', source: technical } };
  render(<ConversationQuestion field={field} value="" custom={false} disabled={false} change={change} />);
  expect(screen.getByText('datos.json')).toBeVisible();
  expect(screen.queryByText(/a6770|\$\.fields/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Usar sugerencia' }));
  expect(change).toHaveBeenCalledWith('6 unidades', false);
  expect(field.suggestion.source).toBe(technical);
});

it('muestra opciones visibles, permite respuesta libre y envía todas las preguntas una sola vez al final', () => {
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  render(<View />); firstAnswer();
  expect(screen.getByLabelText('Pregunta 2 de 2')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Desde cero' })).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: 'Tengo bocetos, pero necesito completar las fotos' } });
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getByRole('radio', { name: 'Desde cero' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Tengo archivos' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Desde cero' }));
  expect(screen.getByPlaceholderText('O escribe tu propia respuesta…')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: 'Tengo bocetos, pero necesito completar las fotos' } });
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  expect(screen.getByLabelText('Nombre')).toHaveValue('Juego de madera');
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Tengo bocetos, pero necesito completar las fotos');
  expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  expect(sendLivePrompt).toHaveBeenCalledWith('Tu producto\nNombre: Juego de madera\nRecursos: Tengo bocetos, pero necesito completar las fotos', expect.objectContaining({ preserveDraft: true }));
  expect(sendLivePrompt).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
});

it('sigue abierto durante active=false del envío, conserva el paso ante fallo y solo cierra con éxito', () => {
  vi.mocked(sendLivePrompt).mockImplementation(text => {
    useWorkspaceStore.getState().pushMessage('t', { role: 'user', text });
    setUi({ pendingReply: { threadId: 't', label: 'Preparando' } });
    return true;
  });
  render(<View />); firstAnswer(); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  expect(screen.getByRole('region', { name: panelName })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cerrar preguntas' })).toBeDisabled();
  act(() => {
    useWorkspaceStore.getState().withdrawLastMessage('t'); setUi({ pendingReply: null });
    vi.mocked(sendLivePrompt).mock.calls[0][1]?.onSettled?.(false, 'Proveedor no disponible');
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Proveedor no disponible');
  expect(screen.getByLabelText('Pregunta 2 de 2')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Desde cero' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  act(() => { setUi({ pendingReply: null }); vi.mocked(sendLivePrompt).mock.calls[1][1]?.onSettled?.(true); });
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  expect(sendLivePrompt).toHaveBeenCalledTimes(2);
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
});

it('cerrar conserva respuestas y paso, permite reabrir desde el mensaje y no envía nada', () => {
  const view = render(<View />); firstAnswer(); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  expect(sendLivePrompt).not.toHaveBeenCalled();
  view.unmount(); render(<View />);
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  openQuestion();
  expect(screen.getByLabelText('Pregunta 2 de 2')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Desde cero' })).toBeChecked();
});

it('mantiene visible un error de validación al cerrar sin perder el borrador', () => {
  render(<View />);
  openQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Completa «Nombre»');
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Completa «Nombre»');
  expect(sendLivePrompt).not.toHaveBeenCalled();
  openQuestion();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juego de madera' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('no abre automáticamente una pregunta del historial y las anteriores no se pueden enviar', () => {
  const view = render(<View autoOpen={false} />);
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  openQuestion();
  expect(screen.getByRole('region', { name: panelName })).toBeVisible();
  view.rerender(<View active={false} autoOpen={false} />);
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Responder pregunta' })).not.toBeInTheDocument();
  expect(screen.getByText('Ver preguntas y borrador')).toBeInTheDocument();
});

it('ocultar el destino conserva la respuesta y recuperarlo no vuelve a tomar el foco', () => {
  render(<input aria-label="Mensaje del chat" />);
  const view = render(<View />); firstAnswer(); choose();
  view.rerender(<View target={null} />);
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  const composer = screen.getByLabelText('Mensaje del chat'); composer.focus();
  view.rerender(<View target={questionTarget} />);
  expect(screen.getByRole('radio', { name: 'Desde cero' })).toBeChecked();
  expect(screen.getByLabelText('Pregunta 2 de 2')).toBeVisible();
  expect(composer).toHaveFocus();
  expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('cambiar de cuenta o hilo cierra la pregunta y ningún callback tardío la vuelve a abrir', () => {
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  const view = render(<View />); firstAnswer(); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  act(() => useWorkspaceStore.setState({ activeThreadId: 'other' }));
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  view.unmount();
  act(() => vi.mocked(sendLivePrompt).mock.calls[0][1]?.onSettled?.(false, 'Tardío'));
  act(() => {
    identity.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed'));
  });
  render(<View />);
  expect(screen.queryByRole('region', { name: panelName })).not.toBeInTheDocument();
  // El correo siguiente no recibe el borrador privado de la cuenta anterior.
  expect(useComposerStore.getState().draft).toBe('');
});

it('la guía de producto adjunta respuestas declarativas sin navegar ni ejecutar acciones desde el panel', () => {
  const guide: ConversationFormData = { id: 'guide-choice', title: 'Cómo quieres continuar', context: { kind: 'product_guide', sku: 'SKU-1', revision: 1, section: 'choice' },
    fields: [{ id: 'mode', label: 'Elige cómo continuar', type: 'select', required: true, options: ['Formulario interactivo', 'Módulo Producto'] }],
  };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'Hilo', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Siguiente paso', conversationForm: guide }] }] });
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  render(<ConversationForm form={guide} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  openQuestion();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.queryByRole('radio', { name: 'Escribir otra respuesta' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Tu respuesta')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Formulario interactivo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
  expect(sendLivePrompt).toHaveBeenCalledWith('Cómo quieres continuar\nElige cómo continuar: Formulario interactivo', expect.objectContaining({ preserveDraft: true,
    formResponse: { formId: 'guide-choice', answers: { mode: 'Formulario interactivo' } },
  }));
});

it('permite aplazar requisitos de Amazon vacíos sin enviarlos como respuestas ni aprobarlos', async () => {
  const requirements: ConversationFormData = { id: 'requirements-1', title: 'Atributos de Amazon', context: { kind: 'product_guide', sku: 'SKU-1', revision: 2, section: 'amazon_requirements', step: 'fields', evaluationId: 'evaluation-2' },
    fields: [{ id: 'image', label: 'Imagen principal', type: 'text', required: true }], submitLabel: 'Guardar y continuar' };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'Hilo', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Siguiente paso', conversationForm: requirements }] }] });
  vi.mocked(sendLivePrompt).mockReturnValue(true);
  vi.spyOn(api, 'get').mockResolvedValue({ product: { sku: 'SKU-1', revision: 2 }, evaluation: {
    state: 'needs_input', evaluationId: 'evaluation-2', fields: requirements.fields,
  } });
  render(<ConversationForm form={requirements} account="one@example.test" threadId="t" messageIndex={0} active autoOpen questionTarget={questionTarget} />);
  openQuestion();
  expect(await screen.findByLabelText('Imagen principal')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Completar más tarde' }));
  expect(sendLivePrompt).toHaveBeenCalledWith('Completaré estos requisitos de Amazon más tarde; continuar con la preparación.', expect.objectContaining({ preserveDraft: true,
    formResponse: { formId: 'requirements-1', answers: { requirements_action: 'later' } },
  }));
  expect(sendLivePrompt).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Completar más tarde' })).toBeDisabled();
  act(() => vi.mocked(sendLivePrompt).mock.calls[0][1]?.onSettled?.(false, 'No se ha podido continuar.'));
  expect(screen.getByLabelText('Imagen principal')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Completar más tarde' })).toBeEnabled();
});

it('no ofrece aplazar como acción de formularios genéricos o aprobaciones de incidencias', () => {
  render(<View />);
  expect(screen.queryByRole('button', { name: 'Completar más tarde' })).not.toBeInTheDocument();
});

it('actualiza una pregunta histórica antes de reabrir y conserva su borrador sin enviarlo', async () => {
  const requirements: ConversationFormData = { id: 'previous-requirement', title: 'Datos de Amazon', context: {
    kind: 'product_guide', sku: 'LAMP-2', revision: 2, section: 'amazon_requirements', step: 'fields', evaluationId: 'old-evaluation' },
    fields: [{ id: 'weight', label: 'Peso real del producto', type: 'text', required: true }] };
  useWorkspaceStore.setState({ activeThreadId: 't', threads: [{ id: 't', title: 'T', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Pregunta', conversationForm: requirements }] }] });
  const props = { form: requirements, account: identity.account, threadId: 't', messageIndex: 0, active: true, questionTarget };
  vi.spyOn(api, 'get').mockResolvedValueOnce({ product: { sku: 'LAMP-2', revision: 2 }, evaluation: {
    state: 'needs_input', evaluationId: 'old-evaluation', fields: requirements.fields,
  } });
  const view = render(<ConversationForm {...props} autoOpen />);
  openQuestion();
  await screen.findByLabelText('Peso real del producto');
  fireEvent.change(screen.getByLabelText('Peso real del producto'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  view.unmount(); render(<ConversationForm {...props} autoOpen={false} />);
  expect(screen.queryByLabelText('Peso real del producto')).not.toBeInTheDocument();
  vi.spyOn(api, 'get').mockResolvedValue({ product: { sku: 'LAMP-2', revision: 3 }, evaluation: { state: 'needs_input', evaluationId: 'new-evaluation', fields: requirements.fields } });
  vi.mocked(prepareProductRequirements).mockReturnValue(true);
  openQuestion();
  await waitFor(() => expect(prepareProductRequirements).toHaveBeenCalledWith('LAMP-2', expect.objectContaining({ onSettled: expect.any(Function) })));
  expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Ver mi borrador anterior'));
  expect(screen.getByText('250')).toBeVisible();
  act(() => vi.mocked(prepareProductRequirements).mock.calls[0][1]?.onSettled?.(false, 'No disponible'));
  expect(screen.getByRole('alert')).toHaveTextContent('No disponible');
  expect(screen.getByText('250')).toBeVisible();
});
