import { create } from 'zustand';
import type { LiveTransportEvent, LiveWorkIntent } from '../api/liveTransport';
import { currentAccountEmail } from '@/modules/auth';
import { useWorkspaceStore } from './workspaceStore';

type Scope = { account: string; epoch: number; threadId: string };
type Turn = Scope & { turnId: string; interpreting: boolean; settled: boolean };
type Work = Scope & { turnId: string; requestId: string; status: string; intent?: LiveWorkIntent; stage?: string;
  speech: 'idle' | 'preparing' | 'settled' };
type Progress = Extract<LiveTransportEvent, { type: 'turn_progress' | 'speech_progress' }>;

export const useLiveWorkProgress = create<{ turns: Turn[]; work: Work[] }>(() => ({ turns: [], work: [] }));
const same = (item: Scope, scope: Scope) => item.account === scope.account && item.epoch === scope.epoch && item.threadId === scope.threadId;
const valid = (scope: Scope) => currentAccountEmail() === scope.account && useWorkspaceStore.getState().historyEpoch === scope.epoch
  && useWorkspaceStore.getState().historyAccount === scope.account;

/** El inicio de otra frase cancela la preparación oral, nunca el trabajo admitido. */
export function observeLiveProgressTurn(scope: Scope, turnId: string): void {
  if (!valid(scope)) return;
  const state = useLiveWorkProgress.getState();
  if (state.turns.some(item => same(item, scope) && item.turnId === turnId)) return;
  useLiveWorkProgress.setState({
    // Otra frase no concluye la interpretación ya iniciada: lo confirma el servidor.
    turns: [...state.turns,
      { ...scope, turnId, interpreting: false, settled: false }].slice(-256),
    work: state.work.map(item => same(item, scope) && item.speech === 'preparing' ? { ...item, speech: 'settled' } : item),
  });
}

export function observeLiveProgress(scope: Scope, event: Progress): void {
  if (!valid(scope) || event.threadId !== scope.threadId) return;
  const state = useLiveWorkProgress.getState();
  if (event.type === 'turn_progress') {
    const turn = state.turns.find(item => same(item, scope) && item.turnId === event.turnId);
    if (!turn || (turn.settled && event.phase === 'interpreting')) return;
    useLiveWorkProgress.setState({ turns: state.turns.map(item => item === turn
      ? { ...item, interpreting: event.phase === 'interpreting', settled: event.phase === 'settled' } : item) });
    return;
  }
  const work = state.work.find(item => same(item, scope) && item.turnId === event.turnId && item.requestId === event.requestId);
  if (!work || (work.speech === 'settled' && event.phase === 'preparing')) return;
  useLiveWorkProgress.setState({ work: state.work.map(item => item === work
    ? { ...item, speech: event.phase === 'preparing' ? 'preparing' : 'settled' } : item) });
}

export function observeLiveProgressWork(scope: Scope, event: Extract<LiveTransportEvent, { type: 'handoff' }>): void {
  if (!valid(scope) || event.threadId !== scope.threadId) return;
  const state = useLiveWorkProgress.getState();
  const old = state.work.find(item => same(item, scope) && item.requestId === event.requestId);
  if (old && (old.turnId !== event.turnId || (!['queued', 'running'].includes(old.status) && ['queued', 'running'].includes(event.status)))) return;
  const work: Work = { ...scope, turnId: event.turnId, requestId: event.requestId, status: event.status,
    intent: event.intent ?? old?.intent, stage: old?.stage, speech: old?.speech ?? 'idle' };
  useLiveWorkProgress.setState({ work: old ? state.work.map(item => item === old ? work : item) : [...state.work, work].slice(-256),
    turns: state.turns.map(item => same(item, scope) && item.turnId === event.turnId ? { ...item, interpreting: false, settled: true } : item) });
}

export function updateLiveWork(scope: Scope, requestId: string, status: string, stage?: string): void {
  if (!valid(scope)) return;
  useLiveWorkProgress.setState(state => ({ work: state.work.map(item => same(item, scope) && item.requestId === requestId
    && (['queued', 'running'].includes(item.status) || !['queued', 'running'].includes(status))
    ? { ...item, status, stage } : item) }));
}

/** Cierra la interpretación del turno, nunca un trabajo admitido. */
export function settleLiveInterpretation(scope: Scope, turnId: string): void {
  if (!valid(scope)) return;
  const state = useLiveWorkProgress.getState();
  const old = state.turns.find(item => same(item, scope) && item.turnId === turnId);
  const settled = { ...scope, turnId, interpreting: false, settled: true };
  useLiveWorkProgress.setState({ turns: old ? state.turns.map(item => item === old ? settled : item)
    : [...state.turns, settled].slice(-256) });
}

export function interruptLiveSpeechProgress(scope: Scope): void {
  if (!valid(scope)) return;
  useLiveWorkProgress.setState(state => ({ work: state.work.map(item => same(item, scope) && item.speech === 'preparing'
    ? { ...item, speech: 'settled' } : item) }));
}

export function endLiveSpeechProgress(scope: Scope, requestId: string): void {
  if (!valid(scope)) return;
  useLiveWorkProgress.setState(state => ({ work: state.work.map(item => same(item, scope) && item.requestId === requestId
    ? { ...item, speech: 'settled' } : item) }));
}

export function clearLiveTransientProgress(): void {
  useLiveWorkProgress.setState(state => ({ turns: [], work: state.work.map(item => ({ ...item, speech: 'settled' })) }));
}

export function liveWorkLabel(intent?: LiveWorkIntent, stage?: string, _status?: string): string {
  const action: Partial<Record<LiveWorkIntent, string>> = { drive_access: 'revisando tu Drive', drive_assist: 'revisando tu Drive',
    drive_count: 'contando las carpetas de tu Drive', drive_search: 'buscando en tu Drive',
    drive_analyze: 'analizando tus documentos de Drive', work_status: 'consultando el estado de tu solicitud',
    create_product: 'preparando tu producto', creative_plan: 'preparando tu propuesta' };
  if (intent === 'recover_request') return 'Uony está recuperando el estado de tu solicitud…';
  if (intent === 'semantic_request' || intent === 'clarify') return 'Uony está entendiendo tu petición…';
  const actionLabel = intent ? action[intent] : undefined;
  // Una fase en cola ya no se nombra como tal: Uony describe directamente lo que hace.
  if (actionLabel) return `Uony está ${actionLabel}…`;
  return ({ preparing: 'Uony está preparando los datos…', consulting_google: 'Uony está preparando tu respuesta…',
    checking_result: 'Uony está ultimando su respuesta…' } as Record<string, string>)[stage ?? ''] ?? 'Uony está trabajando en tu petición…';
}

/** Todos los estados proceden del servidor; una promesa verbal no activa este indicador. */
export function liveProgressLabel(state: { turns: Turn[]; work: Work[] }, scope: Scope): string | null {
  const work = state.work.find(item => same(item, scope) && ['queued', 'running'].includes(item.status));
  if (work) return liveWorkLabel(work.intent, work.stage, work.status);
  if (state.work.some(item => same(item, scope) && item.speech === 'preparing')) return 'Uony está preparando su respuesta…';
  return state.turns.some(item => same(item, scope) && item.interpreting) ? 'Uony está entendiendo tu petición…' : null;
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => useLiveWorkProgress.setState({ turns: [], work: [] }));
