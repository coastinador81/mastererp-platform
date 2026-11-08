import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { creativePreparationKey, creativePreparationOf, useCreativePreparation } from '..';

const identity = vi.hoisted(() => ({ account: 'owner@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const preparation = (threadId = 'creative-thread') => ({ creativePreparation: {
  planId: '11111111-1111-4111-8111-111111111111', revision: 1,
  planSha256: 'a'.repeat(64), threadId, uonifyProjectId: null,
  googleCloudProjectId: 'uonify-757ec8c3ab3245ffa45d', state: 'needs_preparation',
  sourceCurrent: true, model: { model: 'gemini-omni-1.1-flash-preview',
    label: 'Vídeo cinematográfico', medium: 'vídeo', selectionStatus: 'selected' },
  compatibleModels: [], draft: { status: 'not_prepared', snapshotSha256: null,
    requestGroupSha256: null, requestHashes: [], unitIds: ['shot-01'], executionAuthorized: false },
  missingInputs: [], technicalBlockers: ['preparar la estrategia'], quoteReadiness: {
    knownGenerationComponentUsd: null, completeMaximumUsd: null, currency: 'USD',
    approvalReady: false, missingForMaximum: ['cerrar almacenamiento'] },
  limits: { spendLimitUsd: '0.00', providerCallsStarted: 0, executionAuthorized: false },
} });

// Forma avanzada money-neutral (Bloque 1·paso 2): el plan por unidad ya está preparado y persistido en backend.
// state 'prepared' + draft.status 'prepared' con snapshotSha256 (units_sha256, 64 hex); sourceCurrent sigue true.
const prepared = (threadId = 'creative-thread') => ({ creativePreparation: {
  ...preparation(threadId).creativePreparation,
  state: 'prepared',
  draft: { status: 'prepared', snapshotSha256: 'b'.repeat(64),
    requestGroupSha256: null, requestHashes: [], unitIds: ['shot-01'], executionAuthorized: false },
} });

describe('preparación creativa', () => {
  it('rechaza datos de otro hilo o cualquier apertura de gasto', () => {
    expect(creativePreparationOf(preparation(), 'creative-thread')?.sourceCurrent).toBe(true);
    expect(creativePreparationOf(preparation('other'), 'creative-thread')).toBeUndefined();
    const unsafe = preparation();
    unsafe.creativePreparation.quoteReadiness.approvalReady = true;
    expect(creativePreparationOf(unsafe, 'creative-thread')).toBeUndefined();
    const incoherent = preparation();
    incoherent.creativePreparation.state = 'stale';
    expect(creativePreparationOf(incoherent, 'creative-thread')).toBeUndefined();
    const malformed = preparation();
    malformed.creativePreparation.planId = '11111111-1111-4111-8111-11111111111-';
    expect(creativePreparationOf(malformed, 'creative-thread')).toBeUndefined();
  });

  it('acepta la forma «prepared» (plan por unidad preparado) sin abrir gasto', () => {
    const ok = creativePreparationOf(prepared(), 'creative-thread');
    expect(ok?.state).toBe('prepared');
    expect(ok?.sourceCurrent).toBe(true);
    expect(ok?.draft.status).toBe('prepared');
    expect(ok?.draft.snapshotSha256).toBe('b'.repeat(64));
    // Invariantes money-neutral: nada de esto cambia en la forma avanzada.
    expect(ok?.draft.requestGroupSha256).toBeNull();
    expect(ok?.draft.executionAuthorized).toBe(false);
    expect(ok?.quoteReadiness.approvalReady).toBe(false);
    expect(ok?.limits.executionAuthorized).toBe(false);
  });

  it('«prepared» sigue rechazando apertura de gasto y formas de draft incoherentes', () => {
    // Cualquier intento de abrir gasto en la forma avanzada ⇒ undefined.
    const approval = prepared();
    approval.creativePreparation.quoteReadiness.approvalReady = true;
    expect(creativePreparationOf(approval, 'creative-thread')).toBeUndefined();
    const execDraft = prepared();
    execDraft.creativePreparation.draft.executionAuthorized = true;
    expect(creativePreparationOf(execDraft, 'creative-thread')).toBeUndefined();
    const execLimits = prepared();
    execLimits.creativePreparation.limits.executionAuthorized = true;
    expect(creativePreparationOf(execLimits, 'creative-thread')).toBeUndefined();
    // Draft 'prepared' sin hash (snapshotSha256 null) ⇒ incoherente, se rechaza.
    const noHash = preparation();
    noHash.creativePreparation.state = 'prepared';
    noHash.creativePreparation.draft.status = 'prepared';
    expect(creativePreparationOf(noHash, 'creative-thread')).toBeUndefined();
    // Draft 'not_prepared' con hash ⇒ incoherente, se rechaza.
    const hashOnNotPrepared = prepared();
    hashOnNotPrepared.creativePreparation.state = 'needs_preparation';
    hashOnNotPrepared.creativePreparation.draft.status = 'not_prepared';
    expect(creativePreparationOf(hashOnNotPrepared, 'creative-thread')).toBeUndefined();
  });

  it('recupera una sola consulta por cuenta e hilo y separa sus claves', async () => {
    identity.account = 'owner@example.test';
    const get = vi.spyOn(api, 'get').mockResolvedValue(preparation());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(() => useCreativePreparation('owner@example.test', 'creative-thread'), { wrapper });
    await waitFor(() => expect(view.result.current.data?.planId).toBe(
      '11111111-1111-4111-8111-111111111111'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(creativePreparationKey('owner@example.test', 'creative-thread')).not.toEqual(
      creativePreparationKey('other@example.test', 'creative-thread'));
    expect(creativePreparationKey('owner@example.test', 'creative-thread')).not.toEqual(
      creativePreparationKey('owner@example.test', 'other-thread'));
  });

  it('descarta una respuesta tardía de otra cuenta y separa revisión y modelo', async () => {
    identity.account = 'owner@example.test';
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(api, 'get').mockImplementation(async () => {
      await pending;
      return preparation() as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(() => useCreativePreparation(
      'owner@example.test', 'creative-thread',
      { revision: 1, model: 'gemini-omni-1.1-flash-preview' }), { wrapper });
    await waitFor(() => expect(view.result.current.fetchStatus).toBe('fetching'));
    identity.account = 'other@example.test';
    window.dispatchEvent(new CustomEvent('uonify:identity-changed'));
    release();
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.data).toBeUndefined();
    expect(creativePreparationKey('owner@example.test', 'creative-thread', { revision: 1 })).not.toEqual(
      creativePreparationKey('owner@example.test', 'creative-thread', { revision: 2 }));
    expect(creativePreparationKey('owner@example.test', 'creative-thread', { model: 'veo' })).not.toEqual(
      creativePreparationKey('owner@example.test', 'creative-thread', { model: 'omni' }));
  });
});
