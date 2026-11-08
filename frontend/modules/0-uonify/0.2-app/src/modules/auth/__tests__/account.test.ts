import { queryClient } from '@/shared/api/queryClient';
import { currentAccountEmail } from '../index';
import { SIGNED_OUT } from '../model/session';
import { setSession } from '../state/session';

afterEach(() => queryClient.clear());

test('currentAccountEmail: el correo de la sesión iniciada, o null', () => {
  expect(currentAccountEmail()).toBeNull();
  setSession({ ...SIGNED_OUT, authenticated: true, email: 'ana@uonify.com', profile: null, profileReady: false });
  expect(currentAccountEmail()).toBe('ana@uonify.com');
  setSession(SIGNED_OUT);
  expect(currentAccountEmail()).toBeNull();
});
