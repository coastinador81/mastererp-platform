import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

// Voz real, 20-10-2026: entre «entendiendo» y «revisando tu Drive» el aviso desaparecía 55 ms y
// la conversación subía y bajaba 24 px. En voz, el último estado aguanta un instante.
const line = () => document.querySelector('.conversation-active-indicator');
const pending = (label: string | null) => act(() => setUi({ pendingReply: label
  ? { threadId: 'thread-one', requestId: 'request-one', label } : null }));

beforeEach(() => {
  vi.useFakeTimers();
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useWorkspaceStore.setState({ historyAccount: 'pilot@uonify.test', activeThreadId: 'thread-one',
    threads: [{ id: 'thread-one', title: 'Voz', service: null, view: 'default', messages: [] }] });
  useComposerStore.setState({ listening: 'talk' });
});
afterEach(() => { vi.useRealTimers(); useComposerStore.setState({ listening: null }); });

it('en voz, un hueco entre dos estados cambia el texto sin quitar el aviso', () => {
  pending('Uony está entendiendo tu petición…');
  render(<ConversationActiveIndicator />);
  const shown = line();
  pending(null);
  expect(line()).toBe(shown);
  expect(line()).toHaveTextContent('Uony está entendiendo tu petición…');
  act(() => { vi.advanceTimersByTime(55); });
  pending('Uony está revisando tu Drive…');
  expect(line()).toBe(shown);
  expect(line()).toHaveTextContent('Uony está revisando tu Drive…');
});

it('en voz, al terminar desaparece tras un instante; por escrito, en el acto', () => {
  pending('Uony está preparando su respuesta…');
  render(<ConversationActiveIndicator />);
  pending(null);
  expect(line()).not.toBeNull();
  act(() => { vi.advanceTimersByTime(300); });
  expect(line()).toBeNull();
  act(() => useComposerStore.setState({ listening: null }));
  pending('Uony está trabajando en tu petición…');
  expect(line()).not.toBeNull();
  pending(null);
  expect(line()).toBeNull();
});

it('un aviso nuevo en la línea de estado (error o «hablando») lo retira en el acto', () => {
  pending('Uony está entendiendo tu petición…');
  render(<ConversationActiveIndicator />);
  act(() => {
    setUi({ pendingReply: null });
    useComposerStore.setState({ status: 'No he podido confirmar tu petición por voz.', statusThreadId: null });
  });
  expect(line()).toBeNull();
});

it('el paso de escuchar a hablar no corta la pausa entre dos estados', () => {
  act(() => useComposerStore.setState({ status: 'Voz en directo de prueba. Los mensajes confirmados quedan en el chat.',
    statusThreadId: null }));
  pending('Uony está revisando tu Drive…');
  render(<ConversationActiveIndicator />);
  const shown = line();
  act(() => {
    setUi({ pendingReply: null });
    useComposerStore.setState({ status: 'Uony está hablando…' });
  });
  expect(line()).toBe(shown);
  pending('Uony está preparando su respuesta…');
  expect(line()).toBe(shown);
  expect(line()).toHaveTextContent('Uony está preparando su respuesta…');
});

it('al cambiar de conversación no arrastra el aviso de la anterior', () => {
  pending('Uony está revisando tu Drive…');
  render(<ConversationActiveIndicator />);
  act(() => {
    useWorkspaceStore.setState(state => ({ activeThreadId: 'thread-two', threads: [...state.threads,
      { id: 'thread-two', title: 'Otra', service: null, view: 'default', messages: [] }] }));
    setUi({ pendingReply: null });
  });
  expect(line()).toBeNull();
});
