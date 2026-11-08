import { termsKey } from '../lib/terms';

// La cuenta sale del módulo auth (sesión en TanStack Query), no de 'uonify-session'.
const account = vi.hoisted(() => ({ email: null as string | null }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account.email }));

afterEach(() => {
  account.email = null;
  localStorage.clear();
});

test('la aceptación de las condiciones se guarda con la cuenta de la sesión', () => {
  account.email = 'ana@uonify.com';
  localStorage.setItem('uonify-session', JSON.stringify({ user: { email: 'otra@uonify.com' } }));
  expect(termsKey()).toBe('ana@uonify.com:uonify-ai-terms');
});

test('sin sesión en auth, se lee como el prototipo (uonify-session) o queda sin cuenta', () => {
  expect(termsKey()).toBe('uonify-ai-terms');
  localStorage.setItem('uonify-session', JSON.stringify({ user: { email: 'otra@uonify.com' } }));
  expect(termsKey()).toBe('otra@uonify.com:uonify-ai-terms');
});
