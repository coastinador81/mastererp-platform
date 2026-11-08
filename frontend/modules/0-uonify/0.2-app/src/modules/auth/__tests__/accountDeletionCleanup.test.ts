import { queryClient } from '@/shared/api/queryClient';
import { completeSignOut } from '../flows/account';
import { navigation } from '../flows/navigation';
import { SIGNED_OUT } from '../model/session';
import { clearDeletedAccountStorage, ACCOUNT_DELETED_KEY, notifyDeletedAccount } from '../model/deletedAccountStorage';
import { currentAccountEmail, sessionQuery, setSession } from '../state/session';

const account = 'owner@example.test';
const other = 'other@example.test';
const signIn = () => setSession({ ...SIGNED_OUT, authenticated: true, email: account });
beforeEach(() => { queryClient.clear(); localStorage.clear(); sessionStorage.clear(); signIn(); vi.spyOn(navigation, 'hard').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); localStorage.clear(); sessionStorage.clear(); });

test('borra datos de esta cuenta y de la pestaña; conserva otras cuentas y claves ajenas', () => {
  const proposalDecision = (email: string) => 'uonify:product-proposal-decision:v1:'
    + JSON.stringify([email, 'thread-1', '11111111-1111-4111-8111-111111111111']);
  const returnRetry = (email: string) => 'uonify:return-retry:'
    + JSON.stringify([email, 'thread-1', 'BASIC']);
  const assignmentFocus = (email: string) => 'uonify:assignment-focus:'
    + JSON.stringify([email, 'thread-1']);
  const expectedFocus = (email: string) => 'uonify:expected-assignment-focus:'
    + JSON.stringify([email, 'thread-1']);
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem(`${account}:scraped_images_SKU`, 'private');
    storage.setItem(`u_${account}::images`, 'private');
    storage.setItem(`uonify-voice-intro-dismissed:${account}`, 'true');
    storage.setItem(`${other}:scraped_images_SKU`, 'other-private');
    storage.setItem(`uonify-voice-intro-dismissed:${other}`, 'true');
    storage.setItem('unrelated', 'keep');
    storage.setItem(proposalDecision(account), 'private-proposal');
    storage.setItem(proposalDecision(other), 'other-proposal');
    storage.setItem(returnRetry(account), 'private-retry');
    storage.setItem(returnRetry(other), 'other-retry');
    storage.setItem(assignmentFocus(account), 'private-focus');
    storage.setItem(assignmentFocus(other), 'other-focus');
    storage.setItem(expectedFocus(account), 'private-expectation');
    storage.setItem(expectedFocus(other), 'other-expectation');
  }
  for (const key of ['uonify-pim-v1', 'uonify-product-guides-v1', 'uonify-catalog-channels-v1', 'uonify-home-workspace-v1', 'uonify.amazon.intent']) sessionStorage.setItem(key, 'private');
  localStorage.setItem('uonify-session', JSON.stringify({ user: { email: other } }));
  clearDeletedAccountStorage(account);
  for (const storage of [localStorage, sessionStorage]) {
    expect(storage.getItem(`${account}:scraped_images_SKU`)).toBeNull();
    expect(storage.getItem(`u_${account}::images`)).toBeNull();
    expect(storage.getItem(`uonify-voice-intro-dismissed:${account}`)).toBeNull();
    expect(storage.getItem(`${other}:scraped_images_SKU`)).toBe('other-private');
    expect(storage.getItem(`uonify-voice-intro-dismissed:${other}`)).toBe('true');
    expect(storage.getItem('unrelated')).toBe('keep');
    expect(storage.getItem(proposalDecision(account))).toBeNull();
    expect(storage.getItem(proposalDecision(other))).toBe('other-proposal');
    expect(storage.getItem(returnRetry(account))).toBeNull();
    expect(storage.getItem(returnRetry(other))).toBe('other-retry');
    expect(storage.getItem(assignmentFocus(account))).toBeNull();
    expect(storage.getItem(assignmentFocus(other))).toBe('other-focus');
    expect(storage.getItem(expectedFocus(account))).toBeNull();
    expect(storage.getItem(expectedFocus(other))).toBe('other-expectation');
  }
  expect(localStorage.getItem('uonify-session')).toContain(other);
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBeNull();
  localStorage.setItem('uonify-session', JSON.stringify({ user: { email: account } }));
  clearDeletedAccountStorage(account); expect(localStorage.getItem('uonify-session')).toBeNull();
});

test('el éxito cancela consultas, vacía cachés y avisa a los almacenes antes de volver al inicio sin otro logout', async () => {
  const event = vi.fn(); window.addEventListener('uonify:identity-changed', event);
  const cancelled = vi.fn();
  void queryClient.fetchQuery({ queryKey: ['products', account], queryFn: ({ signal }) => new Promise((_yes, no) => {
    signal.addEventListener('abort', () => { cancelled(); no(new DOMException('cancelled', 'AbortError')); });
  }) }).catch(() => {});
  queryClient.setQueryData(['private-account', account], { sources: ['private'] });
  sessionStorage.setItem('uonify-auth-onboarding', 'private');
  sessionStorage.setItem('uonify-product-guides-v1', 'private');
  localStorage.setItem(`${account}:uonify-ai-terms`, 'private');
  await completeSignOut(account);
  expect(cancelled).toHaveBeenCalledOnce(); expect(event).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(['private-account', account])).toBeUndefined();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  expect(currentAccountEmail()).toBeNull(); expect(sessionStorage.getItem('uonify-auth-onboarding')).toBeNull();
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBeNull();
  expect(localStorage.getItem(`${account}:uonify-ai-terms`)).toBeNull();
  expect(navigation.hard).toHaveBeenCalledExactlyOnceWith('/');
  expect(localStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull();
  window.removeEventListener('uonify:identity-changed', event);
});

test('las otras pestañas cierran solo la misma cuenta y la sesión se comprueba siempre al recibir el foco', async () => {
  window.dispatchEvent(new StorageEvent('storage', { key: ACCOUNT_DELETED_KEY, newValue: JSON.stringify({ account: other }) }));
  expect(currentAccountEmail()).toBe(account); expect(navigation.hard).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: ACCOUNT_DELETED_KEY, newValue: JSON.stringify({ account }) }));
  await vi.waitFor(() => expect(navigation.hard).toHaveBeenCalledExactlyOnceWith('/'));
  expect(currentAccountEmail()).toBeNull(); expect(sessionQuery.refetchOnWindowFocus).toBe('always');
});

test('el almacenamiento bloqueado no impide cerrar una cuenta eliminada', async () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => notifyDeletedAccount(account)).not.toThrow();
  await completeSignOut(account);
  expect(currentAccountEmail()).toBeNull(); expect(navigation.hard).toHaveBeenCalledWith('/');
});
