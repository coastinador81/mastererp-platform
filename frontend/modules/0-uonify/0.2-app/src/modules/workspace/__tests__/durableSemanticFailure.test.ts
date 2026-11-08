import { expect, it } from 'vitest';
import { isDurableRequest } from '../api/durableRequests';
import type { SemanticFailure } from '../api/liveSemanticFailure';

const turnId = '11111111-1111-4111-8111-111111111111';
const failure: SemanticFailure = { threadId: 'thread-one', requestId: 'request-one', turnId, category: 'provider',
  phase: 'provider_wait', code: 'google_unavailable', providerCode: 504,
  message: 'No pude interpretar esta petición por un fallo técnico. No he iniciado ninguna acción.',
  interpretation: 'failed', execution: 'not_started', delivery: 'text_only', persistence: 'saved' };
const result = { threadId: 'thread-one', requestId: 'request-one', sourceLiveTurnId: turnId, status: 'error',
  error: { code: failure.code, message: failure.message }, semanticFailure: failure };

it('recupera el fallo guardado manteniendo error y su correlación exacta', () => {
  expect(isDurableRequest(result)).toBe(true);
  expect(isDurableRequest({ ...result, semanticFailure: undefined })).toBe(true);
});

it.each([{ persistence: 'pending' }, { persistence: 'unknown' }, { requestId: 'other-request' },
  { threadId: 'other-thread' }, { turnId: '22222222-2222-4222-8222-222222222222' },
  { execution: 'started' }, { delivery: 'spoken' }, { type: 'semantic_failure' }, { extra: true }])(
  'rechaza metadata del fallo recuperado incoherente: %j', changes => {
    expect(isDurableRequest({ ...result, semanticFailure: { ...failure, ...changes } })).toBe(false);
  });

it('no convierte interpretación fallida en éxito por haber guardado el aviso', () => {
  expect(isDurableRequest({ ...result, status: 'success' })).toBe(false);
  expect(isDurableRequest({ ...result, status: 'running' })).toBe(false);
});

const admissionUnknown: Extract<SemanticFailure, { code: 'semantic_admission_unknown' }> = {
  ...failure, category: 'admission', phase: 'admission', persistence: 'saved',
  code: 'semantic_admission_unknown', interpretation: 'succeeded', execution: 'unknown',
  message: 'He interpretado la petición, pero no puedo confirmar si llegó a iniciarse.' };

it.each(['unknown', 'error'])('admite un recibo incierto guardado con estado %s sin inventar el resultado del trabajo', status => {
  expect(isDurableRequest({ ...result, status, semanticFailure: admissionUnknown })).toBe(true);
});

it('recupera la admisión fallida como error, conservando interpretación correcta', () => {
  const semanticFailure: SemanticFailure = { ...admissionUnknown, code: 'semantic_admission_failed', execution: 'not_started' };
  expect(isDurableRequest({ ...result, semanticFailure })).toBe(true);
  expect(isDurableRequest({ ...result, status: 'unknown', semanticFailure })).toBe(false);
});

it.each(['queued', 'running', 'success', 'cancelled'])('un recibo incierto no afirma estado %s del trabajo', status => {
  expect(isDurableRequest({ ...result, status, semanticFailure: admissionUnknown })).toBe(false);
});

it.each([{ persistence: 'unknown' }, { persistence: 'pending' }, { interpretation: 'failed' },
  { execution: 'not_started' }, { phase: 'classification' }])('rechaza recibos inciertos incompatibles: %j', changes => {
  expect(isDurableRequest({ ...result, status: 'unknown', semanticFailure: { ...admissionUnknown, ...changes } })).toBe(false);
});

it('el GET canónico sigue admitiendo el trabajo reconciliado sin un aviso incierto antiguo', () => {
  expect(isDurableRequest({ ...result, status: 'running', semanticFailure: undefined })).toBe(true);
});
