import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ActivationProfile } from '../components/ActivationProfile';
import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import { STEP_INDEX } from '../model/options';
import { parseSession } from '../model/session';
import { getUi, patchProfile, resetAuthUi } from '../state/authUi';
import { setSession } from '../state/session';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const account = 'compact-profile@example.test';
const saved = { authenticated: true, email: account, account: { provider: 'google' as const }, onboardingStage: 'profile' as const,
  onboarding: { step: 'you' as const }, profileComplete: false, consents: [] };
let compact = true;
const mediaListeners = new Set<() => void>();
beforeEach(() => {
  compact = true; mediaListeners.clear(); queryClient.clear(); resetAuthUi();
  vi.stubGlobal('matchMedia', () => ({ get matches() { return compact; }, addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener), removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener) }));
  setSession(parseSession(saved));
  patchProfile({ step: STEP_INDEX.terms, emailLocked: true, saving: false, status: '', terms: { terms: false, privacy: false, 'ai-third-party': false },
    values: { ...getUi().profile.values, email: account, firstName: 'Ana', lastName: 'García', ageRange: '', role: '', companySize: '', primaryGoal: '', company: '', source: '' } });
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  return { onSaved, ...render(<QueryClientProvider client={queryClient}><ActivationProfile onSaved={onSaved} /></QueryClientProvider>) };
}

it('divide las condiciones sin aceptaciones automáticas ni guardado antes del último apartado', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(saved);
  const { onSaved } = mount();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  for (const checkbox of screen.getAllByRole('checkbox')) await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  expect(post).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  const ai = screen.getByRole('checkbox', { name: /Acepto la cláusula/ });
  expect(ai).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Acepto la cláusula/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledWith('/onboarding/terms', { consents: TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })) }, expect.any(Object));
});

it('comunica un único progreso con nombres comprensibles sin contadores separados', async () => {
  const progress = vi.fn();
  render(<QueryClientProvider client={queryClient}><ActivationProfile onSaved={vi.fn()} onProgress={progress} /></QueryClientProvider>);
  await waitFor(() => expect(progress).toHaveBeenLastCalledWith({ id: 'profile-0', label: 'Condiciones del servicio', index: 1, total: 6 }));
  expect(screen.queryByText(/Tu cuenta ·|Apartado/)).not.toBeInTheDocument();
  for (const checkbox of screen.getAllByRole('checkbox')) await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  expect(progress).toHaveBeenLastCalledWith({ id: 'profile-1', label: 'Uso de la IA', index: 2, total: 6 });
});

it('conserva nombre y edad entre apartados y no permite guardar una edad no válida', async () => {
  patchProfile({ step: STEP_INDEX.you });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ...saved, onboarding: { step: 'work' } });
  const { onSaved } = mount();
  await userEvent.clear(screen.getByLabelText('Nombre')); await userEvent.type(screen.getByLabelText('Nombre'), 'Lucía');
  expect(screen.queryByRole('combobox', { name: 'Franja de edad' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  expect(post).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText('Franja de edad'), 'under18');
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByLabelText('Nombre')).toHaveValue('Lucía');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  await userEvent.selectOptions(screen.getByLabelText('Franja de edad'), '25-34');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledWith('/onboarding/you', { firstName: 'Lucía', lastName: 'García', ageRange: '25-34' }, expect.any(Object));
});

it('un error final conserva actividad, objetivo y campos opcionales para volver a intentarlo', async () => {
  patchProfile({ step: STEP_INDEX.work });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('No se ha podido guardar.'));
  const { onSaved } = mount();
  await userEvent.selectOptions(screen.getByLabelText('Tu actividad'), 'seller');
  await userEvent.selectOptions(screen.getByLabelText('Tamaño del equipo'), '1');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  expect(post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Datos opcionales' }));
  await userEvent.type(screen.getByLabelText(/Empresa/), 'Uonify');
  await userEvent.selectOptions(screen.getByLabelText('¿Qué quieres hacer primero?'), 'catalog');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar mis datos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido guardar.');
  expect(onSaved).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByLabelText('Tu actividad')).toHaveValue('seller');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente apartado' }));
  expect(screen.getByLabelText(/Empresa/)).toHaveValue('Uonify');
  expect(screen.getByLabelText('¿Qué quieres hacer primero?')).toHaveValue('catalog');
  act(() => { compact = false; mediaListeners.forEach(listener => listener()); });
  expect(screen.getByLabelText('Tu actividad')).toBeVisible();
  expect(screen.getByLabelText(/Empresa/)).toHaveValue('Uonify');
});
