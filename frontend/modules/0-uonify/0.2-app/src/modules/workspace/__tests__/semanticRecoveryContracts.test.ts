import { expect, it } from 'vitest';
import { isDurableRequest } from '../api/durableRequests';
import { semanticRecoveryOf, type SemanticRecovery } from '../api/semanticRecovery';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const recovery: SemanticRecovery = { logicalRequestId: A, recoveryCommandId: B, semanticAttemptId: null,
  businessExecutionId: A, businessRequestId: A, disposition: 'observing', businessStatus: 'running' };
const receipt = { requestId: B, threadId: 'thread-one', status: 'success', semanticRecovery: recovery };

it('separa el éxito de la orden B del trabajo A todavía activo y conserva compatibilidad histórica', () => {
  expect(isDurableRequest(receipt)).toBe(true);
  expect(isDurableRequest({ ...receipt, semanticRecovery: undefined })).toBe(true);
  expect(semanticRecoveryOf(recovery, B)).toEqual(recovery);
});

it.each(['observing', 'reconciliation_required', 'blocked'] as const)('admite %s sin negocio admitido ni sondeo inventado', disposition => {
  expect(semanticRecoveryOf({ ...recovery, disposition, businessRequestId: null,
    businessExecutionId: null, businessStatus: null }, B)).not.toBeNull();
});

it('admite un intento recuperado alojado en B y un resultado de A reutilizado', () => {
  expect(semanticRecoveryOf({ ...recovery, disposition: 'reclassified', businessRequestId: B, semanticAttemptId: B }, B)).not.toBeNull();
  expect(semanticRecoveryOf({ ...recovery, disposition: 'reused', businessStatus: 'success' }, B)).not.toBeNull();
});

it('acepta el recibo observado separado del negocio aún no admitido y su ausencia histórica', () => {
  expect(semanticRecoveryOf({ ...recovery, observedRequestId: A,
    businessRequestId: null, businessExecutionId: null, businessStatus: null }, B)).not.toBeNull();
  expect(semanticRecoveryOf({ ...recovery, observedRequestId: null }, B)).not.toBeNull();
  expect(semanticRecoveryOf(recovery, B)).not.toBeNull();
});

it.each([{ logicalRequestId: null }, { recoveryCommandId: A }, { semanticAttemptId: 'invented' },
  { businessExecutionId: undefined }, { businessRequestId: 'other' }, { disposition: 'retry' },
  { businessStatus: 'done' }, { extra: true }, { disposition: 'reclassified' },
  { disposition: 'reused', businessRequestId: null }, { observedRequestId: 'invented' },
  { observedRequestId: undefined }, { observedRequestId: A, disposition: 'blocked' },
  { businessExecutionId: null }, { businessRequestId: null },
  { businessRequestId: null, businessExecutionId: null, businessStatus: 'running' }])('rechaza procedencia inválida o cruzada: %j', change => {
  expect(isDurableRequest({ ...receipt, semanticRecovery: { ...recovery, ...change } })).toBe(false);
});
