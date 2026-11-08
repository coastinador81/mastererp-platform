import { api, ApiError } from '@/shared/api/client';
import { clearReturnRetryIntent, isReturnRetryRequest, readReturnRetryIntent,
  reconcileReturnRetryIntent, releaseReturnRetryRequest, retainReturnRetryRequest,
  returnRetryIntents, saveReturnRetryIntent } from '../api/returnRetryIntent';

const identity = { account: 'qa@example.test', threadId: 'basic-thread', sku: 'BASIC', revision: 11, linkVersion: 2,
  reasoningId: '12345678-1234-4123-8123-123456789abc', reasoningStatus: 'unknown' as const,
  sourceFingerprint: 'a'.repeat(64) };

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('persiste un único UUID y cuerpo vinculado a cuenta, hilo, SKU, revisión y job', () => {
  const first = saveReturnRetryIntent(identity, 'google-project', true);
  expect(first).toMatchObject({ ...identity, projectId: 'google-project', acknowledgeUnknown: true });
  expect(first?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(saveReturnRetryIntent(identity, 'otro-proyecto', false)).toEqual(first);
  expect(readReturnRetryIntent(identity)).toEqual(first);
  expect(isReturnRetryRequest(identity.account, identity.threadId, first!.requestId)).toBe(true);
  expect(isReturnRetryRequest('otra@example.test', identity.threadId, first!.requestId)).toBe(false);
  expect(isReturnRetryRequest(identity.account, 'otro-hilo', first!.requestId)).toBe(false);
});

it('no genera UUID nuevo si el job, la revisión o la huella cambiaron sin conciliación', () => {
  const first = saveReturnRetryIntent(identity, null, true)!;
  expect(saveReturnRetryIntent({ ...identity, revision: 12 }, null, true)).toBeNull();
  expect(saveReturnRetryIntent({ ...identity, linkVersion: 3 }, null, true)).toBeNull();
  expect(saveReturnRetryIntent({ ...identity, reasoningId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, null, true)).toBeNull();
  expect(saveReturnRetryIntent({ ...identity, sourceFingerprint: 'b'.repeat(64) }, null, true)).toBeNull();
  expect(readReturnRetryIntent(identity)?.requestId).toBe(first.requestId);
  clearReturnRetryIntent({ ...first, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  expect(readReturnRetryIntent(identity)?.requestId).toBe(first.requestId);
  clearReturnRetryIntent(first);
  expect(readReturnRetryIntent(identity)).toBeNull();
});

it('un registro ilegible detiene la acción en lugar de sobrescribir su UUID', () => {
  localStorage.setItem('uonify:return-retry:' + JSON.stringify([identity.account, identity.threadId, identity.sku]), '{');
  expect(saveReturnRetryIntent(identity, null, true)).toBeNull();
});

it('mantiene identificado el request pendiente entre CAS 409 y limpieza de pendingReply', () => {
  const intent = saveReturnRetryIntent(identity, null, true)!;
  retainReturnRetryRequest(intent);
  clearReturnRetryIntent(intent);
  expect(isReturnRetryRequest(identity.account, identity.threadId, intent.requestId)).toBe(true);
  releaseReturnRetryRequest(intent);
  expect(isReturnRetryRequest(identity.account, identity.threadId, intent.requestId)).toBe(false);
});

it('una clave corrupta de otra ficha no oculta una intención válida del hilo', () => {
  localStorage.setItem('uonify:return-retry:' + JSON.stringify([identity.account, identity.threadId, 'AAA']), '{');
  const intent = saveReturnRetryIntent(identity, null, true)!;
  expect(returnRetryIntents(identity.account, identity.threadId)).toEqual([intent]);
  expect(isReturnRetryRequest(identity.account, identity.threadId, intent.requestId)).toBe(true);
});

it('GET de recibo solo libera el UUID al confirmar éxito del mismo contrato CAS', async () => {
  const intent = saveReturnRetryIntent(identity, 'google-project', true)!;
  const receipt = { requestId: intent.requestId, threadId: intent.threadId, status: 'success', action: {
    kind: 'requirements_prepare', action: 'prepare', sku: intent.sku, retry: true, acknowledgeUnknown: true,
    expectedRevision: intent.revision, expectedLinkVersion: intent.linkVersion,
    expectedReasoningId: intent.reasoningId, expectedReasoningStatus: intent.reasoningStatus,
    expectedSourceFingerprint: intent.sourceFingerprint,
  } };
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ ...receipt,
    action: { ...receipt.action, expectedLinkVersion: 99 } }).mockResolvedValueOnce({ ...receipt,
      action: { ...receipt.action, action: 'other' } }).mockResolvedValueOnce(receipt);
  expect(returnRetryIntents(identity.account, identity.threadId)).toEqual([intent]);
  expect(await reconcileReturnRetryIntent(intent)).toBe(false);
  expect(readReturnRetryIntent(intent)?.requestId).toBe(intent.requestId);
  expect(await reconcileReturnRetryIntent(intent)).toBe(false);
  expect(readReturnRetryIntent(intent)?.requestId).toBe(intent.requestId);
  expect(await reconcileReturnRetryIntent(intent)).toBe(true);
  expect(readReturnRetryIntent(intent)).toBeNull();
  expect(get.mock.calls[0][0]).toBe(`/uony/threads/basic-thread/requests/${intent.requestId}/receipt`);
});

it('un recibo ausente no crea UUID nuevo ni declara fallido un POST concurrente', async () => {
  const intent = saveReturnRetryIntent(identity, null, true)!;
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, { error: 'request_not_found' }));
  await expect(reconcileReturnRetryIntent(intent)).rejects.toMatchObject({ status: 404 });
  expect(saveReturnRetryIntent(identity, null, true)?.requestId).toBe(intent.requestId);
  expect(saveReturnRetryIntent({ ...identity, revision: 12 }, null, true)).toBeNull();
});
