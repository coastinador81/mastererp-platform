import { AMAZON_INTENT_TTL, amazonIntentQuery, clearAmazonIntent, rememberAmazonIntent, useAmazonIntent } from './intent';

afterEach(() => { clearAmazonIntent(); vi.useRealTimers(); });

it('retira únicamente el intent de la dirección y conserva el resto de parámetros', () => {
  expect(amazonIntentQuery('?amazon_intent=opaque-value&service=nexus&filter=all')).toEqual({ id: 'opaque-value', search: '?service=nexus&filter=all' });
  expect(amazonIntentQuery('?amazon_intent=one&amazon_intent=two')).toEqual({ id: 'one', search: '' });
  expect(amazonIntentQuery('?auth=return')).toBeNull();
});

it('conserva solo el ID opaco y la fecha para volver del acceso, sin alargar su caducidad', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T20:00:00Z'));
  rememberAmazonIntent('opaque-intent');
  const initial = useAmazonIntent.getState().pending;
  expect(JSON.parse(sessionStorage.getItem('uonify.amazon.intent')!)).toEqual({ id: 'opaque-intent', createdAt: Date.now() });
  vi.advanceTimersByTime(60_000);
  rememberAmazonIntent('opaque-intent');
  expect(useAmazonIntent.getState().pending).toEqual(initial);
  clearAmazonIntent();
  expect(sessionStorage.getItem('uonify.amazon.intent')).toBeNull();
  expect(useAmazonIntent.getState().pending).toBeNull();
});

it('rechaza IDs vacíos o desproporcionados sin guardarlos', () => {
  for (const id of ['', '   ', 'a'.repeat(513)]) {
    rememberAmazonIntent(id);
    expect(useAmazonIntent.getState().pending).toBeNull();
    expect(sessionStorage.getItem('uonify.amazon.intent')).toBeNull();
  }
});

it('recupera el traspaso de sesión al recargar y elimina el que ha caducado', async () => {
  vi.useFakeTimers();
  rememberAmazonIntent('intent-after-login');
  vi.resetModules();
  const reloaded = await import('./intent');
  expect(reloaded.useAmazonIntent.getState().pending?.id).toBe('intent-after-login');
  vi.advanceTimersByTime(AMAZON_INTENT_TTL + 1);
  vi.resetModules();
  const expired = await import('./intent');
  expect(expired.useAmazonIntent.getState().pending).toBeNull();
  expect(sessionStorage.getItem('uonify.amazon.intent')).toBeNull();
});
