import { api } from '@/shared/api/client';
import { createReturnFollowUpIntent, getReturnBrief, postReturnFollowUp } from '../api/conversationCards';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api', apiUrl: (path: string) => `/api${path}` }));
const identity = vi.hoisted(() => ({ account: 'one@example.test', cookie: 'synthetic-ai18-session-one' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const liveUrl = import.meta.env.VITE_AI18_E2E_URL;

it.skipIf(!liveUrl)('cruza el cliente real con FastAPI en un esquema aislado: aplazar, cierre, replay, 409 y cuenta', async () => {
  const nativeFetch = globalThis.fetch;
  const transport = (input: RequestInfo | URL, init?: RequestInit) => nativeFetch(`${liveUrl}${String(input)}`, {
    ...init,
    headers: { ...init?.headers, Origin: 'http://127.0.0.1:5173', Cookie: `uonify_session=${identity.cookie}` },
  });
  vi.stubGlobal('fetch', transport);
  try {
    const first = await getReturnBrief('basic-thread');
    expect(first.product).toMatchObject({ sku: 'BASIC', name: 'Basic Mini Bricks', revision: 2 });
    expect(first.confirmedFacts.map(fact => fact.value)).toEqual(expect.arrayContaining([
      '500 g', '19,90 €', 'Adultos y familias', 'No aplicable',
    ]));
    expect(first.trackingVersion).toBe(0);
    const pending = first.pending.find(item => item.id === 'preparation:auditoria');
    expect(pending?.followUp).toBe('open');
    const defer = createReturnFollowUpIntent(identity.account, 'basic-thread', first, 'defer', pending!.id);
    const applied = await postReturnFollowUp(defer);
    expect(applied).toMatchObject({ kind: 'applied', event: { trackingVersion: 1 } });
    expect(await postReturnFollowUp(defer)).toEqual(applied);
    const deferred = await getReturnBrief('basic-thread');
    expect(deferred.pending[0].followUp).toBe('deferred');
    expect(deferred.followUpHistory).toHaveLength(1);
    const stale = createReturnFollowUpIntent(identity.account, 'basic-thread', first, 'defer', pending!.id);
    expect(await postReturnFollowUp(stale)).toMatchObject({ kind: 'conflict', code: 'return_brief_conflict' });
    expect(await postReturnFollowUp({ ...defer, requestId: crypto.randomUUID(), action: 'resolve',
      expectedVersion: deferred.trackingVersion, sourceFingerprint: deferred.sourceFingerprint! }))
      .toMatchObject({ kind: 'conflict', code: 'pending_still_current' });

    identity.account = 'two@example.test';
    identity.cookie = 'synthetic-ai18-session-two';
    await expect(postReturnFollowUp(defer)).rejects.toMatchObject({ name: 'AbortError' });
    const other = await getReturnBrief('basic-thread');
    expect(other.product).toMatchObject({ sku: 'SECOND', name: 'Otra ficha' });
    expect(other.confirmedFacts.some(fact => fact.value === '500 g')).toBe(false);
    expect(other.trackingVersion).toBe(0);

    let releaseResponse: (() => void) | undefined;
    let receivedResponse!: () => void;
    const responseReceived = new Promise<void>(resolve => { receivedResponse = resolve; });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await transport(input, init);
      if (init?.method === 'POST' && String(input).endsWith('/return-brief/follow-up')) {
        return new Promise<Response>(resolve => {
          releaseResponse = () => resolve(response);
          receivedResponse();
        });
      }
      return response;
    });
    const otherDefer = createReturnFollowUpIntent(identity.account, 'basic-thread', other,
      'defer', other.pending[0].id);
    const late = postReturnFollowUp(otherDefer);
    await responseReceived;
    identity.account = 'one@example.test';
    identity.cookie = 'synthetic-ai18-session-one';
    releaseResponse!();
    await expect(late).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('fetch', transport);
    expect((await getReturnBrief('basic-thread')).trackingVersion).toBe(1);
    identity.account = 'two@example.test';
    identity.cookie = 'synthetic-ai18-session-two';
    expect((await getReturnBrief('basic-thread')).pending[0].followUp).toBe('deferred');

    identity.account = 'one@example.test';
    identity.cookie = 'synthetic-ai18-session-one';
    await api.patch('/products/BASIC/preparation', { revision: 2, section: 'auditoria', reviewed: true });
    const readyToClose = await getReturnBrief('basic-thread');
    expect(readyToClose.pending).toHaveLength(0);
    expect(readyToClose.completedFollowUps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pending!.id, canResolve: true }),
    ]));
    const resolve = createReturnFollowUpIntent(identity.account, 'basic-thread', readyToClose,
      'resolve', pending!.id);
    const closed = await postReturnFollowUp(resolve);
    expect(closed).toMatchObject({ kind: 'applied', event: { trackingVersion: 2 } });
    expect(await postReturnFollowUp(resolve)).toEqual(closed);
    const final = await getReturnBrief('basic-thread');
    expect(final.trackingVersion).toBe(2);
    expect(final.completedFollowUps).toHaveLength(0);
    expect(final.followUpHistory.map(event => event.action)).toEqual(['resolve', 'defer']);
  } finally {
    vi.unstubAllGlobals();
    identity.account = 'one@example.test';
    identity.cookie = 'synthetic-ai18-session-one';
  }
});
