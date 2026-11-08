import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import { useComposerStore } from '../hooks/composerStore';
import { clearLiveTransientProgress, endLiveSpeechProgress, liveProgressLabel, observeLiveProgress,
  observeLiveProgressTurn, observeLiveProgressWork, updateLiveWork, useLiveWorkProgress } from '../hooks/liveWorkProgress';
const owner = vi.hoisted(() => ({ email: 'progress@uonify.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => owner.email }));
const scope = () => ({ account: owner.email, epoch: useWorkspaceStore.getState().historyEpoch, threadId: 'thread-one' });
const label = () => liveProgressLabel(useLiveWorkProgress.getState(), scope());
const turn = (turnId = 'turn-one') => observeLiveProgressTurn(scope(), turnId);
const interpretation = (phase: 'interpreting' | 'settled', turnId = 'turn-one') => observeLiveProgress(scope(), {
  type: 'turn_progress', threadId: 'thread-one', turnId, phase });
const handoff = (status: 'queued' | 'running' | 'success' | 'error', requestId = 'request-one', turnId = 'turn-one') =>
  observeLiveProgressWork(scope(), { type: 'handoff', threadId: 'thread-one', turnId, requestId, status, intent: 'drive_count' });
const speech = (phase: 'preparing' | 'settled' | 'failed', requestId = 'request-one', turnId = 'turn-one') =>
  observeLiveProgress(scope(), phase === 'failed'
    ? { type: 'speech_progress', threadId: 'thread-one', turnId, requestId, phase,
      reason: 'narration_unavailable' }
    : { type: 'speech_progress', threadId: 'thread-one', turnId, requestId, phase });

beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null }); useLiveWorkProgress.setState({ turns: [], work: [] });
  useComposerStore.setState({ status: '', threadStatuses: {} });
  useWorkspaceStore.setState({ historyAccount: owner.email, activeThreadId: 'thread-one',
    threads: [{ id: 'thread-one', title: '1er producto', service: null, view: 'default', messages: [] }] });
});

it('usa el indicador existente durante interpretación sin afirmar que Drive esté ejecutándose', () => {
  turn(); interpretation('interpreting'); render(<ConversationActiveIndicator />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Uony está entendiendo tu petición…');
  expect(useLiveWorkProgress.getState().work).toEqual([]);
  act(() => interpretation('settled'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('no infiere progreso de una respuesta verbal ni admite progreso de un turno desconocido', () => {
  interpretation('interpreting'); speech('preparing');
  expect(label()).toBeNull();
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(item => ({ ...item,
    messages: [{ role: 'assistant', text: 'Sigo procesando tu solicitud' }] })) }));
  render(<ConversationActiveIndicator />); expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('mantiene el recuento real al empezar otra frase y no muestra IA de Google', () => {
  turn(); handoff('running'); turn('turn-two'); interpretation('interpreting', 'turn-two');
  updateLiveWork(scope(), 'request-one', 'running', 'consulting_google');
  expect(label()).toBe('Uony está contando las carpetas de tu Drive…');
  expect(useLiveWorkProgress.getState().work[0].status).toBe('running');
});

it('muestra preparación de voz tras resultado y la retira al comenzar el audio', () => {
  turn(); handoff('success'); speech('preparing');
  expect(label()).toBe('Uony está preparando su respuesta…');
  endLiveSpeechProgress(scope(), 'request-one'); expect(label()).toBeNull();
  speech('preparing'); expect(label()).toBeNull();
});

it('retira preparación ante fallo del narrador y no la reabre con el settled final', () => {
  turn(); handoff('success'); speech('preparing');
  expect(label()).toBe('Uony está preparando su respuesta…');
  speech('failed'); expect(label()).toBeNull();
  speech('settled'); speech('preparing'); expect(label()).toBeNull();
});

it.each(['settled', 'interrupt', 'stop'] as const)('retira preparación oral por %s sin reabrirla con eventos tardíos', mode => {
  turn(); handoff('success'); speech('preparing');
  if (mode === 'settled') speech('settled');
  else if (mode === 'interrupt') turn('turn-two');
  else clearLiveTransientProgress();
  speech('preparing'); expect(label()).toBeNull();
});

it('rechaza progreso cruzado por cuenta, epoch, hilo, turno y requestId', () => {
  turn(); handoff('success');
  for (const change of [{ account: 'other@uonify.test' }, { epoch: -1 }, { threadId: 'thread-two' }])
    observeLiveProgress({ ...scope(), ...change }, { type: 'speech_progress', threadId: 'thread-one',
      turnId: 'turn-one', requestId: 'request-one', phase: 'preparing' });
  speech('preparing', 'other-request'); speech('preparing', 'request-one', 'other-turn');
  expect(label()).toBeNull();
});

it('no reabre interpretación ni trabajo terminado por un evento antiguo', () => {
  turn(); interpretation('interpreting'); interpretation('settled'); turn('turn-two'); interpretation('interpreting');
  expect(label()).toBeNull();
  handoff('success'); handoff('running'); expect(label()).toBeNull();
});

it('conserva la interpretación de una orden final cuando empieza otra frase antes del handoff', () => {
  turn(); interpretation('interpreting'); render(<ConversationActiveIndicator />);
  act(() => { turn('turn-two'); interpretation('interpreting', 'turn-two'); });
  expect(screen.getAllByRole('status')).toHaveLength(1);
  act(() => interpretation('settled', 'turn-two'));
  expect(screen.getByRole('status')).toHaveTextContent('Uony está entendiendo tu petición…');
  act(() => handoff('running'));
  expect(screen.getByRole('status')).toHaveTextContent('Uony está contando las carpetas de tu Drive…');
  act(() => handoff('success'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('no borra la interpretación pendiente de otro turno al terminar el anterior', () => {
  turn(); interpretation('interpreting'); turn('turn-two'); interpretation('interpreting', 'turn-two');
  interpretation('settled');
  expect(label()).toBe('Uony está entendiendo tu petición…');
  interpretation('settled', 'turn-two'); expect(label()).toBeNull();
});

it('sigue mostrando un segundo trabajo tras terminar el primero', () => {
  turn(); handoff('running'); turn('turn-two'); handoff('queued', 'request-two', 'turn-two');
  handoff('success'); expect(label()).toBe('Uony está contando las carpetas de tu Drive…');
  updateLiveWork(scope(), 'request-two', 'error'); expect(label()).toBeNull();
});

it('mantiene un solo indicador cuando coincide con pendingReply durable', () => {
  turn(); handoff('running');
  setUi({ pendingReply: { threadId: 'thread-one', requestId: 'request-one', label: 'Uony está contando las carpetas de tu Drive…' } });
  render(<ConversationActiveIndicator />); expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('un job de interpretación no anuncia una consulta de Drive que todavía no está resuelta', () => {
  turn(); observeLiveProgressWork(scope(), { type: 'handoff', threadId: 'thread-one', turnId: 'turn-one',
    requestId: 'request-one', status: 'running', intent: 'semantic_request' });
  updateLiveWork(scope(), 'request-one', 'running', 'consulting_google');
  expect(label()).toBe('Uony está entendiendo tu petición…');
});
