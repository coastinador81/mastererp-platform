import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ActivationAccountMenu } from '../components/ActivationAccountMenu';
import { navigation } from '../flows/navigation';
import { parseSession } from '../model/session';
import { STEP_INDEX } from '../model/options';
import { getUi, patchProfile, resetAuthUi } from '../state/authUi';
import { currentSession, setSession } from '../state/session';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const navigate = vi.fn();
beforeEach(() => {
  queryClient.clear(); sessionStorage.clear(); resetAuthUi(); navigate.mockReset();
  window.dispatchEvent(new Event('uonify:identity-changed'));
  setSession(parseSession({ authenticated: true, email: 'ana@example.test', account: { provider: 'google' },
    identity: { name: 'Ana García' }, onboardingStage: 'profile', onboarding: { step: 'terms' }, profileComplete: false }));
  navigation.bind(navigate, '/espacio');
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });
const mount = () => render(<QueryClientProvider client={queryClient}><main><ActivationAccountMenu /><button>Fuera del menú</button></main></QueryClientProvider>);

it('reutiliza el avatar y el menú existentes con identidad real sin consultar herramientas antes del acceso', async () => {
  const get = vi.spyOn(api, 'get'), post = vi.spyOn(api, 'post'); mount();
  const avatar = screen.getByRole('button', { name: /^Cuenta:\s*Ana García$/ });
  expect(avatar).toHaveClass('account-button'); expect(avatar.querySelector('.account-avatar')).toHaveTextContent('A');
  await userEvent.click(avatar);
  const menu = screen.getByRole('region', { name: 'Cuenta' });
  expect(menu).toHaveClass('account-popover', 'composer-account-menu');
  expect(within(menu).getByText('Ana García')).toBeVisible(); expect(within(menu).getByText('ana@example.test')).toBeVisible();
  expect(within(menu).getByRole('button', { name: 'Configuración' })).toBeVisible();
  expect(within(menu).getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

it('Configuración conserva el apartado y los borradores del alta sin montar módulos privados', async () => {
  const get = vi.spyOn(api, 'get'), post = vi.spyOn(api, 'post'); mount();
  patchProfile({ step: STEP_INDEX.work, values: { ...getUi().profile.values, company: 'Empresa todavía sin guardar' }, terms: { terms: true, privacy: true, 'ai-third-party': false } });
  await userEvent.click(screen.getByRole('button', { name: /^Cuenta:\s*Ana García$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Configuración' }));
  await waitFor(() => expect(getUi().profile.step).toBe(STEP_INDEX.work));
  expect(getUi().profile.values.company).toBe('Empresa todavía sin guardar');
  expect(getUi().profile.terms).toEqual({ terms: true, privacy: true, 'ai-third-party': false });
  expect(screen.queryByRole('region', { name: 'Cuenta' })).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  expect(currentSession().profileReady).toBe(false);
});

it('Escape devuelve el foco al avatar y pulsar fuera cierra el mismo menú', async () => {
  mount(); const avatar = screen.getByRole('button', { name: /^Cuenta:\s*Ana García$/ });
  await userEvent.click(avatar); expect(screen.getByRole('button', { name: 'Configuración' })).toHaveFocus();
  await userEvent.keyboard('{Escape}'); expect(avatar).toHaveFocus(); expect(avatar).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(avatar); await userEvent.click(screen.getByRole('button', { name: 'Fuera del menú' }));
  expect(avatar).toHaveAttribute('aria-expanded', 'false');
});

it('Cerrar sesión utiliza el cierre real del backend, limpia el acceso y vuelve a la portada', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ authenticated: false });
  const post = vi.spyOn(api, 'post').mockResolvedValue({}); const hard = vi.spyOn(navigation, 'hard').mockImplementation(() => {});
  mount(); await userEvent.click(screen.getByRole('button', { name: /^Cuenta:\s*Ana García$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(hard).toHaveBeenCalledExactlyOnceWith('/'));
  expect(post).toHaveBeenCalledExactlyOnceWith('/auth/logout', undefined, { signal: expect.any(AbortSignal) });
  expect(currentSession().authenticated).toBe(false);
});
