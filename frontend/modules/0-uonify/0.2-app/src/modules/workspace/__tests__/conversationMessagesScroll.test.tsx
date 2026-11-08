import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ConversationMessages } from '../components/ConversationMessages';
import { Composer } from '../components/composer/Composer';
import { useComposerStore } from '../hooks/composerStore';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { useVoiceSubtitles } from '../hooks/voiceSubtitles';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: null }) }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter>
    <ConversationMessages centredInService={false} /><Composer />
  </MemoryRouter></QueryClientProvider>);
  const list = view.container.querySelector<HTMLElement>('.conversation-messages')!;
  let height = 1000;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 200 });
  return { list, grow: () => { height += 100; } };
}

beforeEach(() => {
  resetWorkspaceStore();
  useLiveTranscriptPreview.getState().clear();
  setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Otra pregunta para Uony', status: '' });
  useWorkspaceStore.setState({ activeThreadId: 'basic', threads: [{ id: 'basic', title: 'Basic Mini Bricks',
    service: null, view: 'default', messages: [{ role: 'user', text: 'Quiero crear Basic Mini Bricks' }] }] });
});
afterEach(() => vi.restoreAllMocks());

it('presenta la respuesta definitiva del mismo turno sin ocultar la voz de otro turno', () => {
  useWorkspaceStore.setState({ activeThreadId: 'basic', threads: [{ id: 'basic', title: 'Drive',
    service: null, view: 'default', messages: [
      { role: 'user', turnId: 'u1', text: '¿Tienes acceso a mi Drive?' },
      { role: 'assistant', turnId: 'a1', replyToTurnId: 'u1', text: 'Estoy comprobando el acceso.' },
      { role: 'assistant', requestId: 'request-1', sourceLiveTurnId: 'u1', text: 'Ya puedo consultar tu Drive.' },
      { role: 'user', turnId: 'u2', text: 'Gracias.' },
      { role: 'assistant', turnId: 'a2', replyToTurnId: 'u2', text: 'De nada.' },
    ] }] });
  mount();
  expect(screen.queryByText('Estoy comprobando el acceso.')).not.toBeInTheDocument();
  expect(screen.getByText('Ya puedo consultar tu Drive.')).toBeInTheDocument();
  expect(screen.getByText('¿Tienes acceso a mi Drive?')).toBeInTheDocument();
  expect(screen.getByText('Gracias.')).toBeInTheDocument();
  expect(screen.getByText('De nada.')).toBeInTheDocument();
});

it('conserva la posición de lectura y el borrador cuando llega una respuesta o cambia el estado', () => {
  const { list, grow } = mount();
  list.scrollTop = 180;
  fireEvent.scroll(list);
  grow();
  act(() => setUi({ pendingReply: { threadId: 'basic', label: 'Uony está revisando…' } }));
  expect(list.scrollTop).toBe(180);
  grow();
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'Ya tengo los datos de Basic.' });
    setUi({ pendingReply: null });
  });
  expect(list.scrollTop).toBe(180);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Otra pregunta para Uony');
  expect(useComposerStore.getState().draft).toBe('Otra pregunta para Uony');
});

it('sigue la conversación cuando estaba al final o la persona envía un mensaje nuevo', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('assistant') ? 1070 : 0;
  });
  const { list, grow } = mount();
  list.scrollTop = 800;
  fireEvent.scroll(list);
  grow();
  act(() => useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'Avance del producto.' }));
  expect(list.scrollTop).toBe(1070);

  list.scrollTop = 120;
  fireEvent.scroll(list);
  grow();
  act(() => useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text: 'Otra petición.' }));
  expect(list.scrollTop).toBe(1200);
});

it('muestra la voz provisional en el cuadro sin tocar el borrador y la respuesta en el chat sin saltar de lectura', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  useComposerStore.setState({ listening: 'talk' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const { list, grow } = mount();
  const input = screen.getByRole('textbox', { name: 'Escribe a Uony' });
  list.scrollTop = 180;
  fireEvent.scroll(list);
  grow();
  act(() => useLiveTranscriptPreview.getState().show({ account: 'pilot@uonify.test', epoch,
    threadId: 'basic', role: 'user', turnId: 'user-1', text: 'Estoy describiendo el producto' }));
  expect(input).toHaveValue('Otra pregunta para Uony\nEstoy describiendo el producto');
  expect(input).toHaveAttribute('readonly');
  expect(useComposerStore.getState().draft).toBe('Otra pregunta para Uony');
  fireEvent.submit(document.getElementById('composer')!);
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'basic')?.messages).toHaveLength(1);
  act(() => useLiveTranscriptPreview.getState().show({ account: 'pilot@uonify.test', epoch,
    threadId: 'basic', role: 'assistant', turnId: 'assistant-1', text: 'Te escucho y preparo' }));
  expect(list).toHaveTextContent('Te escucho y preparo');
  expect(list.scrollTop).toBe(180);
  act(() => {
    useWorkspaceStore.getState().pushMessage('basic', { role: 'user', text: 'Estoy describiendo el producto', turnId: 'user-1' });
    useLiveTranscriptPreview.getState().remove('basic', 'user', 'user-1');
    useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant', text: 'Te escucho y preparo', turnId: 'assistant-1' });
    useLiveTranscriptPreview.getState().remove('basic', 'assistant', 'assistant-1');
  });
  expect(input).toHaveValue('Otra pregunta para Uony');
  expect(input).not.toHaveAttribute('readonly');
  expect(list.querySelectorAll('.message.assistant')).toHaveLength(1);
  expect(list.scrollTop).toBe(180);
  act(() => useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread =>
    thread.id === 'basic' ? { ...thread, messages: [...thread.messages] } : thread) })));
  expect(list.querySelectorAll('.message.assistant')).toHaveLength(1);
});

it('presenta la voz en el cuadro vacío sin convertirla en borrador enviable', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  useComposerStore.setState({ draft: '', listening: 'talk' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  mount();
  act(() => useLiveTranscriptPreview.getState().show({ account: 'pilot@uonify.test', epoch,
    threadId: 'basic', role: 'user', turnId: 'user-2', text: 'Este es mi producto' }));
  const input = screen.getByRole('textbox', { name: 'Escribe a Uony' });
  expect(input).toHaveValue('Este es mi producto');
  expect(useComposerStore.getState().draft).toBe('');
  fireEvent.submit(document.getElementById('composer')!);
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'basic')?.messages).toHaveLength(1);
});

it('mueve la frase del cuadro al chat al callar y mantiene el orden si Uony termina antes', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  useComposerStore.setState({ listening: 'talk' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const { list } = mount();
  const turn = { account: 'pilot@uonify.test', epoch, threadId: 'basic', turnId: 'voice-1', anchorIndex: 1 };
  act(() => {
    useLiveTranscriptPreview.getState().startUser(turn);
    useLiveTranscriptPreview.getState().show({ ...turn, role: 'user', text: 'Quiero hacer un producto' });
  });
  const input = screen.getByRole('textbox', { name: 'Escribe a Uony' });
  expect(input).toHaveValue('Otra pregunta para Uony\nQuiero hacer un producto');
  act(() => useLiveTranscriptPreview.getState().endUser(turn));
  expect(input).toHaveValue('Otra pregunta para Uony');
  expect([...list.querySelectorAll('.message')].map(node => node.textContent)).toEqual([
    'Quiero crear Basic Mini Bricks', 'Quiero hacer un producto',
  ]);
  act(() => useWorkspaceStore.getState().pushMessage('basic', { role: 'assistant',
    text: 'Claro, lo hacemos', turnId: 'reply-1' }));
  expect([...list.querySelectorAll('.message')].map(node => node.textContent)).toEqual([
    'Quiero crear Basic Mini Bricks', 'Quiero hacer un producto', 'Claro, lo hacemos',
  ]);
  act(() => {
    useWorkspaceStore.getState().insertLiveUserMessage('basic', { role: 'user',
      text: 'Quiero hacer un producto', turnId: 'voice-1' }, 1);
    useLiveTranscriptPreview.getState().remove('basic', 'user', 'voice-1');
  });
  expect([...list.querySelectorAll('.message')].map(node => node.textContent)).toEqual([
    'Quiero crear Basic Mini Bricks', 'Quiero hacer un producto', 'Claro, lo hacemos',
  ]);
  expect(useComposerStore.getState().draft).toBe('Otra pregunta para Uony');
});

it('sitúa a1 debajo de u1 y antes de u2, aun tras timeout y final tardío de u1', () => {
  vi.useFakeTimers();
  try {
    useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
    const epoch = useWorkspaceStore.getState().historyEpoch;
    const { list } = mount();
    const u1 = { account: 'pilot@uonify.test', epoch, threadId: 'basic', turnId: 'u1', anchorIndex: 1 };
    const u2 = { ...u1, turnId: 'u2', anchorIndex: 2 };
    const visible = () => [...list.querySelectorAll('.message')].map(node => node.textContent);
    act(() => {
      useLiveTranscriptPreview.getState().startUser(u1); useLiveTranscriptPreview.getState().endUser(u1);
      useLiveTranscriptPreview.getState().startUser(u2); useLiveTranscriptPreview.getState().endUser(u2);
      useLiveTranscriptPreview.getState().show({ ...u1, role: 'assistant', turnId: 'a1',
        replyToTurnId: 'u1', text: 'Respuesta provisional' });
    });
    expect(visible()).toEqual(['Quiero crear Basic Mini Bricks', 'Transcribiendo tu voz…',
      'Respuesta provisional', 'Transcribiendo tu voz…']);
    act(() => vi.advanceTimersByTime(12_000));
    act(() => {
      const index = useWorkspaceStore.getState().insertLiveAssistantAfterPending('basic',
        { role: 'assistant', turnId: 'a1', text: 'Respuesta confirmada' }, 1, ['u2']);
      if (index !== null) useLiveTranscriptPreview.getState().rebase('basic', index, ['u2']);
      useLiveTranscriptPreview.getState().remove('basic', 'assistant', 'a1');
    });
    expect(visible()).toEqual(['Quiero crear Basic Mini Bricks', 'No disponible la transcripción de este turno',
      'Respuesta confirmada', 'No disponible la transcripción de este turno']);
    act(() => {
      const index = useWorkspaceStore.getState().insertLiveUserMessage('basic',
        { role: 'user', turnId: 'u1', text: 'Pregunta primera' }, 1, ['u2'], ['a1']);
      if (index !== null) useLiveTranscriptPreview.getState().rebase('basic', index, ['u2']);
      useLiveTranscriptPreview.getState().remove('basic', 'user', 'u1');
    });
    expect(visible()).toEqual(['Quiero crear Basic Mini Bricks', 'Pregunta primera',
      'Respuesta confirmada', 'No disponible la transcripción de este turno']);
  } finally { useLiveTranscriptPreview.getState().clear(); vi.useRealTimers(); }
});

it('el final tardío de u1 no cancela la caducidad de la preview activa de u2', () => {
  vi.useFakeTimers();
  try {
    useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
    useComposerStore.setState({ listening: 'talk' });
    const epoch = useWorkspaceStore.getState().historyEpoch;
    mount();
    const u1 = { account: 'pilot@uonify.test', epoch, threadId: 'basic', turnId: 'u1', anchorIndex: 1 };
    const u2 = { ...u1, turnId: 'u2', anchorIndex: 2 };
    act(() => {
      useLiveTranscriptPreview.getState().startUser(u1); useLiveTranscriptPreview.getState().endUser(u1);
      useLiveTranscriptPreview.getState().startUser(u2);
      useLiveTranscriptPreview.getState().show({ ...u2, role: 'user', text: 'Hablo del segundo' });
    });
    expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Otra pregunta para Uony\nHablo del segundo');
    act(() => {
      const index = useWorkspaceStore.getState().insertLiveUserMessage('basic',
        { role: 'user', turnId: 'u1', text: 'Primera frase' }, 1, ['u2']);
      if (index !== null) useLiveTranscriptPreview.getState().rebase('basic', index, ['u2']);
      useLiveTranscriptPreview.getState().remove('basic', 'user', 'u1');
      vi.advanceTimersByTime(8_000);
    });
    expect(useLiveTranscriptPreview.getState().previews.some(item => item.turnId === 'u2')).toBe(false);
    expect(useLiveTranscriptPreview.getState().pendingUsers.map(item => item.turnId)).toEqual(['u2']);
    expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Otra pregunta para Uony');
  } finally { useLiveTranscriptPreview.getState().clear(); vi.useRealTimers(); }
});

it('usa un marcador explícito si Google no aporta texto y lo retira sin inventar palabras', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const { list } = mount();
  const turn = { account: 'pilot@uonify.test', epoch, threadId: 'basic', turnId: 'silent-1', anchorIndex: 1 };
  act(() => {
    useLiveTranscriptPreview.getState().startUser(turn);
    useLiveTranscriptPreview.getState().endUser(turn);
  });
  expect(list).toHaveTextContent('Transcribiendo tu voz…');
  act(() => useLiveTranscriptPreview.getState().remove('basic', 'user', 'silent-1'));
  expect(list).not.toHaveTextContent('Transcribiendo tu voz…');
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'basic')?.messages).toHaveLength(1);
});

it('mantiene el marcador tras 13 segundos, sigue el final y respeta a quien lee arriba', () => {
  vi.useFakeTimers();
  try {
    useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
    const epoch = useWorkspaceStore.getState().historyEpoch;
    const { list, grow } = mount();
    const first = { account: 'pilot@uonify.test', epoch, threadId: 'basic', turnId: 'late-1', anchorIndex: 1 };
    list.scrollTop = 800; fireEvent.scroll(list); grow();
    act(() => { useLiveTranscriptPreview.getState().startUser(first); useLiveTranscriptPreview.getState().endUser(first); });
    expect(list.scrollTop).toBe(1100);
    act(() => vi.advanceTimersByTime(13_000));
    expect(list).toHaveTextContent('No disponible la transcripción de este turno');
    list.scrollTop = 180; fireEvent.scroll(list); grow();
    const second = { ...first, turnId: 'late-2', anchorIndex: 1 };
    act(() => { useLiveTranscriptPreview.getState().startUser(second); useLiveTranscriptPreview.getState().endUser(second); });
    expect(list.scrollTop).toBe(180);
  } finally { useLiveTranscriptPreview.getState().clear(); vi.useRealTimers(); }
});

it('una preview sin final caduca, libera el borrador manual y no crea mensaje', () => {
  vi.useFakeTimers();
  try {
    useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
    useComposerStore.setState({ draft: 'Borrador conservado', listening: 'talk' });
    const epoch = useWorkspaceStore.getState().historyEpoch;
    mount();
    const preview = (text: string) => act(() => useLiveTranscriptPreview.getState().show({
      account: 'pilot@uonify.test', epoch, threadId: 'basic', role: 'user', turnId: 'user-3', text,
    }));
    preview('Estoy hablando');
    const input = screen.getByRole('textbox', { name: 'Escribe a Uony' });
    expect(input).toHaveValue('Borrador conservado\nEstoy hablando');
    act(() => vi.advanceTimersByTime(7_000));
    preview('Estoy hablando todavía');
    act(() => vi.advanceTimersByTime(7_999));
    expect(input).toHaveValue('Borrador conservado\nEstoy hablando todavía');
    act(() => vi.advanceTimersByTime(1));
    expect(input).toHaveValue('Borrador conservado');
    expect(input).not.toHaveAttribute('readonly');
    expect(useComposerStore.getState().draft).toBe('Borrador conservado');
    expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'basic')?.messages).toHaveLength(1);
  } finally { useLiveTranscriptPreview.getState().clear(); vi.useRealTimers(); }
});

it('sigue los subtítulos de voz al fondo mientras se escriben y respeta la lectura manual', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const scope = { account: 'pilot@uonify.test', epoch, threadId: 'basic' };
  useVoiceSubtitles.getState().clear();
  try {
    const { list, grow } = mount();
    // Al fondo: al escribirse el subtítulo de Uony, la vista lo sigue hasta abajo.
    list.scrollTop = 800; fireEvent.scroll(list); grow();
    act(() => useVoiceSubtitles.getState().applySubtitle(scope, 'uony', 'Estoy preparando tu', false));
    expect(list.scrollTop).toBe(1100);
    // Subió a leer el historial: el subtítulo crece pero NO se fuerza el scroll.
    list.scrollTop = 180; fireEvent.scroll(list); grow();
    act(() => useVoiceSubtitles.getState().applySubtitle(scope, 'uony', 'Estoy preparando tu vídeo ahora mismo', false));
    expect(list.scrollTop).toBe(180);
  } finally { useVoiceSubtitles.getState().clear(); }
});

it('sigue la respuesta Live al final aunque una tarjeta antigua esté más arriba', () => {
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test' });
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const { list, grow } = mount();
  const oldGuide = document.createElement('div');
  oldGuide.className = 'uony-guide';
  Object.defineProperty(oldGuide, 'offsetTop', { value: 50 });
  list.appendChild(oldGuide);
  list.scrollTop = 800;
  fireEvent.scroll(list);
  grow();
  act(() => useLiveTranscriptPreview.getState().show({ account: 'pilot@uonify.test', epoch,
    threadId: 'basic', role: 'assistant', turnId: 'assistant-3', text: 'Ya encontré tus datos' }));
  expect(list.scrollTop).toBe(1100);
});
