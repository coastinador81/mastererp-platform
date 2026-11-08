import { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConversationPanel, type ConversationPanelProps } from '../components/ConversationPanel';
import { useComposerStore } from '../hooks/composerStore';
import { clearConversationFormDrafts } from '../hooks/conversationFormDrafts';
import { sendLivePrompt } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import type { Thread } from '../model/workspaceState';

const session = vi.hoisted(() => ({ account: 'one@example.test', composerSubmits: vi.fn() }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => session.account, ConversationActivationPanel: () => null, useConversationActivationOpen: () => false }));
vi.mock('@/modules/catalog', () => ({ GuideCard: () => null }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: { email: session.account } }) }));
vi.mock('../hooks/liveConversation', () => ({ sendLivePrompt: vi.fn(), useConversationRecovery: () => null }));
vi.mock('../hooks/conversation', () => ({ sendPrompt: vi.fn() }));
vi.mock('../components/ConversationRecovery', () => ({ ConversationRecovery: () => null }));
vi.mock('../components/ConversationConnection', () => ({ ConversationConnection: ({ provider }: { provider: string }) => <button type="button">Gestionar {provider}</button> }));
vi.mock('../components/composer/Composer', () => ({ Composer: () => {
  const draft = useComposerStore(state => state.draft);
  const focusTick = useComposerStore(state => state.focusTick);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusTick) input.current?.focus(); }, [focusTick]);
  return <form className="composer" aria-label="Compositor" onSubmit={event => { event.preventDefault(); session.composerSubmits(); }}>
    <textarea ref={input} aria-label="Escribe a Uony" value={draft} onChange={event => useComposerStore.getState().setDraft(event.target.value)} />
    <button type="submit">Enviar chat</button>
  </form>;
} }));

const thread = (id: string): Thread => ({ id, title: id, service: null, view: 'default', messages: [
  { role: 'assistant', text: 'Tu conexión', connectionActions: [{ provider: 'drive', action: 'manage' }] },
  { role: 'assistant', text: 'Cuéntame sobre tu producto', conversationFormFresh: true, conversationForm: {
    id: `form-${id}`, title: 'Tu producto', fields: [
      { id: 'name', label: 'Nombre', type: 'text', required: true },
      { id: 'source', label: 'Recursos', type: 'select', required: true, options: ['Desde cero', 'Tengo archivos'] },
    ],
  } },
] });

beforeEach(() => {
  session.account = 'one@example.test'; session.composerSubmits.mockReset();
  vi.mocked(sendLivePrompt).mockReset();
  clearConversationFormDrafts(); resetWorkspaceStore(); setUi({ pendingReply: null, navOpen: false });
  useComposerStore.setState({ draft: 'Mi siguiente mensaje', focusTick: 0 });
  useWorkspaceStore.setState({ activeThreadId: 'one', threads: [thread('one'), thread('two')] });
});

function View(props: ConversationPanelProps) {
  return <MemoryRouter initialEntries={['/espacio/producto/SKU-1']}>
    <button type="button">Acción del producto</button><ConversationPanel {...props} />
  </MemoryRouter>;
}

it('la respuesta genérica de un dato muestra la misma pregunta validada al pasar al historial', () => {
  const one = thread('one');
  one.messages[1].text = 'Completa estos datos para continuar.';
  one.messages[1].conversationForm = { id: 'source-question', title: 'Tu producto', fields: [{
    id: 'source', label: '¿Tienes archivos o prefieres empezar desde cero?', type: 'select', required: true,
    options: ['Tengo archivos', 'Desde cero'],
  }] };
  useWorkspaceStore.setState({ activeThreadId: 'one', threads: [one] });
  render(<View />);
  expect(screen.getAllByText('¿Tienes archivos o prefieres empezar desde cero?').find(element => element.classList.contains('message'))).toBeVisible();
  expect(screen.queryByText('Completa estos datos para continuar.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Responder pregunta' })).toBeVisible();
  act(() => useWorkspaceStore.getState().pushMessage('one', { role: 'assistant', text: 'La seguimos más tarde.' }));
  expect(screen.getAllByText('¿Tienes archivos o prefieres empezar desde cero?').find(element => element.classList.contains('message'))).toBeVisible();
  expect(screen.queryByText('Completa estos datos para continuar.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Responder pregunta' })).not.toBeInTheDocument();
  expect(screen.getByText('Ver preguntas y borrador')).toBeInTheDocument();
});

it('conserva una frase breve y añade la pregunta concreta sin duplicarla al entrar en el historial', () => {
  const one = thread('one');
  const statement = 'Para preparar el producto, primero necesito saber de dónde partimos.';
  const question = '¿Cómo prefieres empezar a preparar tu producto?';
  one.messages[1].text = statement;
  one.messages[1].conversationForm = { id: 'source-question', title: 'Tu producto', fields: [{
    id: 'source', label: question, type: 'select', required: true,
    options: ['Tengo una carpeta en Google Drive', 'Quiero escribirlo desde cero'],
  }] };
  useWorkspaceStore.setState({ activeThreadId: 'one', threads: [one] });
  render(<View />);
  const message = document.querySelector('.conversation-messages > .message.assistant.has-question');
  expect(message?.firstChild?.textContent).toBe(`${statement}\n${question}`);
  act(() => useWorkspaceStore.getState().pushMessage('one', { role: 'assistant', text: 'Hablamos de otra cosa.' }));
  expect(message?.firstChild?.textContent).toBe(`${statement}\n${question}`);
  expect(screen.queryByRole('button', { name: 'Responder pregunta' })).not.toBeInTheDocument();
});

it('no repite la etiqueta cuando el mensaje ya contiene una pregunta', () => {
  const one = thread('one');
  const question = '¿Cómo prefieres empezar a preparar tu producto?';
  one.messages[1].text = question;
  one.messages[1].conversationForm = { id: 'source-question', title: 'Tu producto', fields: [{
    id: 'source', label: question, type: 'select', required: true, options: ['Con archivos', 'Desde cero'],
  }] };
  useWorkspaceStore.setState({ activeThreadId: 'one', threads: [one] });
  render(<View />);
  expect(document.querySelector('.conversation-messages > .message.assistant.has-question')?.firstChild?.textContent).toBe(question);
});

it.each([{ sidePanel: false }, { sidePanel: true }, { centredInService: true }])('coloca la pregunta antes del compositor en su propio dock (%j), sin modal ni bloqueo', async props => {
  const { container } = render(<View {...props} />);
  const anchor = container.querySelector('.conversation-question-anchor')!;
  const composer = screen.getByRole('form', { name: 'Compositor' });
  expect(anchor).toBeEmptyDOMElement();
  expect(screen.queryByRole('region', { name: 'Pregunta de Uony: Tu producto' })).not.toBeInTheDocument();
  const invitation = screen.getByRole('button', { name: 'Responder pregunta' });
  expect(invitation.closest('.conversation-messages')).not.toBeNull();
  fireEvent.click(invitation);
  const panel = await screen.findByRole('region', { name: 'Pregunta de Uony: Tu producto' });
  expect(panel.parentElement).toBe(anchor);
  expect(anchor.parentElement).toBe(composer.parentElement);
  expect(anchor.nextElementSibling).toBe(composer);
  expect(panel.closest('.conversation-messages')).toBeNull();
  expect(panel.closest('.conversation-dock')).not.toBeNull();
  expect(panel.closest('dialog')).toBeNull();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body).not.toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: 'Acción del producto' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Escribe a Uony'), { target: { value: 'Puedo seguir escribiendo' } });
  expect(useComposerStore.getState().draft).toBe('Puedo seguir escribiendo');
  expect(screen.getByRole('button', { name: 'Gestionar drive' }).closest('.conversation-messages')).not.toBeNull();
  expect(within(panel).queryByRole('button', { name: 'Gestionar drive' })).not.toBeInTheDocument();
});

it('retira la tarjeta cuando el dock está oculto, inerte o sin compositor, y conserva sus respuestas al volver', async () => {
  const view = render(<View />);
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Juego de madera' } });
  for (const props of [{ hidden: true }, { inert: true }, { withComposer: false }]) {
    view.rerender(<View {...props} />);
    expect(screen.queryByRole('region', { name: 'Pregunta de Uony: Tu producto' })).not.toBeInTheDocument();
    expect(document.querySelector('.conversation-question-anchor')).toBeEmptyDOMElement();
    view.rerender(<View />);
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Juego de madera');
  }
  expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('al cambiar de hilo aísla valores y paso; cerrar y retomar devuelve el foco sin borrar el compositor', async () => {
  render(<View />);
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Juego de madera' } });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Tengo archivos' }));
  act(() => useWorkspaceStore.getState().setActiveThread('two'));
  expect(screen.queryByRole('region', { name: 'Pregunta de Uony: Tu producto' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  expect(await screen.findByLabelText('Nombre')).toHaveValue('');
  act(() => useWorkspaceStore.getState().setActiveThread('one'));
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  expect(await screen.findByRole('radio', { name: 'Tengo archivos' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar preguntas' }));
  expect(screen.queryByRole('region', { name: 'Pregunta de Uony: Tu producto' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Escribe a Uony')).toHaveFocus();
  expect(screen.getByLabelText('Escribe a Uony')).toHaveValue('Mi siguiente mensaje');
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  expect(screen.getByRole('radio', { name: 'Tengo archivos' })).toBeChecked();
});

it('una pregunta recibida deja el borrador intacto y solo se abre al elegir responder', async () => {
  render(<View />);
  expect(screen.getByRole('button', { name: 'Responder pregunta' })).toBeVisible();
  const composer = screen.getByLabelText('Escribe a Uony');
  composer.focus();
  fireEvent.change(composer, { target: { value: 'Estoy terminando este mensaje' } });
  act(() => useWorkspaceStore.getState().pushMessage('one', { role: 'assistant', text: 'Puedes seguir cuando quieras.', conversationFormFresh: true,
    conversationForm: { id: 'next-question', title: 'Siguiente paso', fields: [{ id: 'detail', label: 'Detalle', type: 'text', required: false }] },
  }));
  expect(screen.queryByRole('region', { name: 'Pregunta de Uony: Siguiente paso' })).not.toBeInTheDocument();
  expect(composer).toHaveFocus();
  expect(composer).toHaveValue('Estoy terminando este mensaje');
  expect(screen.getAllByRole('button', { name: 'Responder pregunta' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  expect(await screen.findByRole('region', { name: 'Pregunta de Uony: Siguiente paso' })).toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: /^Pregunta de Uony:/ })).toHaveLength(1);
});

it('enviar preguntas usa el mismo hilo una vez y no dispara el formulario del compositor', async () => {
  vi.mocked(sendLivePrompt).mockImplementation(text => {
    useWorkspaceStore.getState().pushMessage('one', { role: 'user', text });
    setUi({ pendingReply: { threadId: 'one', label: 'Preparando respuesta' } });
    return true;
  });
  const { container } = render(<View />);
  fireEvent.click(screen.getByRole('button', { name: 'Responder pregunta' }));
  fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Juego de madera' } });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Desde cero' }));
  expect(sendLivePrompt).not.toHaveBeenCalled();
  const panel = screen.getByRole('region', { name: 'Pregunta de Uony: Tu producto' });
  fireEvent.submit(panel.querySelector('form')!);
  expect(sendLivePrompt).toHaveBeenCalledOnce();
  expect(session.composerSubmits).not.toHaveBeenCalled();
  expect(container.querySelectorAll('form form')).toHaveLength(0);
  expect(panel).toBeInTheDocument();
  act(() => {
    useWorkspaceStore.getState().withdrawLastMessage('one'); setUi({ pendingReply: null });
    vi.mocked(sendLivePrompt).mock.calls[0][1]?.onSettled?.(false, 'Inténtalo otra vez');
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Inténtalo otra vez');
  expect(screen.getByRole('radio', { name: 'Desde cero' })).toBeChecked();
  expect(useComposerStore.getState().draft).toBe('Mi siguiente mensaje');
});

it('sustituye la revisión antigua de recursos y conserva el compositor disponible', async () => {
  const one = thread('one');
  const form = one.messages[1].conversationForm!;
  form.context = { kind: 'drive_analysis', sku: 'BASIC', revision: 3, section: 'review',
    analysisId: '11111111-1111-4111-8111-111111111111', proposalIds: ['name'] };
  form.fields[0].resourceEvidence = Array.from({ length: 65 }, (_, index) => ({
    sourceName: `Foto ${index + 1}.png`, locator: 'Fotograma 1', excerpt: `Lectura ${index + 1}`,
  }));
  useWorkspaceStore.setState({ threads: [one], activeThreadId: 'one' });
  const { container } = render(<View />);
  expect(await screen.findByRole('button', { name: 'Continuar con Uony' })).toBeVisible();
  expect(screen.queryByText('Ver recursos y citas · 65')).not.toBeInTheDocument();
  expect(container.querySelector('.conversation-question-anchor')).toBeEmptyDOMElement();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Escribe a Uony'), { target: { value: 'Mi borrador sigue disponible' } });
  expect(useComposerStore.getState().draft).toBe('Mi borrador sigue disponible');
  expect(sendLivePrompt).not.toHaveBeenCalled();
});
