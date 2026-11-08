import { api, ApiError } from '@/shared/api/client';
import { createReturnFollowUpIntent, getReturnBrief, postReturnFollowUp,
  type ReturnBrief } from '../api/conversationCards';

const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const pendingId = 'preparation:auditoria';
const fingerprint = 'a'.repeat(64);
const brief: ReturnBrief = {
  product: { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 3 },
  confirmedFacts: [], status: { amazonRequirements: 'needs_input' },
  pending: [{ id: pendingId, kind: 'preparation', label: 'Revisar el apartado auditoria',
    sourceFingerprint: 'b'.repeat(64), followUp: 'open' }],
  completedFollowUps: [{ id: 'materials:old_job', label: 'Revisar materiales', canResolve: true }],
  followUpHistory: [{ action: 'defer', pendingId: 'materials:old_job',
    label: 'Revisar materiales', version: 1, at: '2026-10-16T12:00:00+00:00' }],
  trackingVersion: 1, sourceFingerprint: fingerprint,
  nextAction: 'review_preparation', summary: 'La ficha está guardada.',
};

beforeEach(() => { identity.account = 'sellerify@example.test'; });
afterEach(() => vi.restoreAllMocks());

it('lee el seguimiento completo sin iniciar acciones y rechaza campos de control ausentes', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: brief });
  const post = vi.spyOn(api, 'post');
  expect(await getReturnBrief('basic-thread')).toMatchObject({
    trackingVersion: 1, sourceFingerprint: fingerprint,
    completedFollowUps: [{ id: 'materials:old_job', canResolve: true }],
    followUpHistory: [{ action: 'defer', version: 1 }],
  });
  expect(get).toHaveBeenCalledWith('/uony/threads/basic-thread/return-brief', { signal: undefined });
  expect(post).not.toHaveBeenCalled();
  get.mockResolvedValueOnce({ returnBrief: { ...brief, sourceFingerprint: undefined } });
  await expect(getReturnBrief('basic-thread')).rejects.toThrow('No hemos podido recuperar');
});

it.each([
  { trackingVersion: -1 },
  { completedFollowUps: undefined },
  { followUpHistory: [{ ...brief.followUpHistory[0], version: 0 }] },
  { pending: [{ ...brief.pending[0], sourceFingerprint: 'sin-huella' }] },
])('no acepta un resumen incompleto para seguimiento: %j', async patch => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief, ...patch } });
  await expect(getReturnBrief('basic-thread')).rejects.toThrow('No hemos podido recuperar');
});

it('crea un UUID por intención a partir de un asunto visible y no inventa cierres', () => {
  const defer = createReturnFollowUpIntent(identity.account, 'basic-thread', brief, 'defer', pendingId);
  expect(defer).toMatchObject({ account: identity.account, threadId: 'basic-thread',
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), action: 'defer', pendingId,
    expectedVersion: 1, productRevision: 3, sourceFingerprint: fingerprint });
  const resolve = createReturnFollowUpIntent(identity.account, 'basic-thread', brief,
    'resolve', 'materials:old_job');
  expect(resolve.action).toBe('resolve');
  expect(resolve.requestId).not.toBe(defer.requestId);
  expect(() => createReturnFollowUpIntent(identity.account, 'basic-thread', brief,
    'resolve', pendingId)).toThrow('ya no está disponible');
  expect(() => createReturnFollowUpIntent(identity.account, 'basic-thread', brief,
    'defer', 'materials:old_job')).toThrow('ya no está disponible');
});

it('reenvía el mismo UUID y cuerpo sin introducir la cuenta en el POST', async () => {
  const intent = createReturnFollowUpIntent(identity.account, 'basic/thread', brief, 'defer', pendingId);
  const event = { requestId: intent.requestId, action: 'defer', pendingId, trackingVersion: 2 };
  const post = vi.spyOn(api, 'post').mockResolvedValue({ event });
  expect(await postReturnFollowUp(intent)).toEqual({ kind: 'applied', event });
  expect(await postReturnFollowUp(intent)).toEqual({ kind: 'applied', event });
  expect(post).toHaveBeenCalledTimes(2);
  for (const [path, body] of post.mock.calls) {
    expect(path).toBe('/uony/threads/basic%2Fthread/return-brief/follow-up');
    expect(body).toEqual({ requestId: intent.requestId, action: 'defer', pendingId,
      expectedVersion: 1, productRevision: 3, sourceFingerprint: fingerprint });
  }
});

it('trata el 409 como conflicto sin aplicar ni refrescar automáticamente un estado antiguo', async () => {
  const intent = createReturnFollowUpIntent(identity.account, 'basic-thread', brief, 'defer', pendingId);
  const get = vi.spyOn(api, 'get');
  vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { error: 'return_brief_conflict' }));
  expect(await postReturnFollowUp(intent)).toEqual({ kind: 'conflict', code: 'return_brief_conflict' });
  expect(get).not.toHaveBeenCalled();
});

it('rechaza una respuesta que no corresponde a la intención original', async () => {
  const intent = createReturnFollowUpIntent(identity.account, 'basic-thread', brief, 'defer', pendingId);
  vi.spyOn(api, 'post').mockResolvedValue({ event: { requestId: 'otra', action: 'defer',
    pendingId, trackingVersion: 2 } });
  await expect(postReturnFollowUp(intent)).rejects.toThrow('No hemos podido comprobar');
});

it('no envía con otra cuenta ni aplica una respuesta tardía tras cambiar de identidad', async () => {
  const intent = createReturnFollowUpIntent(identity.account, 'basic-thread', brief, 'defer', pendingId);
  const post = vi.spyOn(api, 'post');
  identity.account = 'otra@example.test';
  await expect(postReturnFollowUp(intent)).rejects.toMatchObject({ name: 'AbortError' });
  expect(post).not.toHaveBeenCalled();
  identity.account = intent.account;
  let finish: (value: unknown) => void = () => {};
  post.mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
  const awaiting = postReturnFollowUp(intent);
  identity.account = 'otra@example.test';
  finish({ event: { requestId: intent.requestId, action: 'defer', pendingId, trackingVersion: 2 } });
  await expect(awaiting).rejects.toMatchObject({ name: 'AbortError' });
});
