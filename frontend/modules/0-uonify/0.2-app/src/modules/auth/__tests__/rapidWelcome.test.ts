import { billingApi } from '@/modules/billing';
import { setSession } from '../state/session';
import { SIGNED_OUT } from '../model/session';
import { emptyProfileValues, profileFromValues } from '../model/profile';
import { transitionToWorkspace, resetWorkspaceFlow } from '../flows/workspace';
import { resetTransitionClock } from '../flows/transition';
import { navigation } from '../flows/navigation';
import { configureTiming } from '../model/timing';
import { getUi, resetAuthUi } from '../state/authUi';

afterEach(() => {
  resetTransitionClock(); resetWorkspaceFlow(); resetAuthUi(); setSession(SIGNED_OUT);
  vi.useRealTimers(); vi.restoreAllMocks();
});

test('la bienvenida completa permite continuar en menos de seis segundos con los tiempos reales', async () => {
  vi.useFakeTimers(); configureTiming(); resetAuthUi();
  vi.spyOn(navigation, 'onWorkspace').mockReturnValue(true);
  const opening = transitionToWorkspace();
  expect(getUi().transition.open).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  expect(getUi().transition.title).toBe('Preparando tu entorno');
  await vi.advanceTimersByTimeAsync(1000);
  expect(getUi().transition.title).toBe('Un espacio a tu medida');
  await vi.advanceTimersByTimeAsync(4000);
  await opening;
  expect(getUi().transition.open).toBe(false);
  expect(getUi().surface.active).toBe(false);
});


test.each([true, false])('la última pantalla anuncia el pago solo si sigue pendiente (%s)', async pending => {
  vi.useFakeTimers(); configureTiming(); resetAuthUi();
  setSession({ ...SIGNED_OUT, authenticated: true, profileReady: true, profile: profileFromValues({ ...emptyProfileValues(), firstName: 'Ana', plan: 'basic' }) });
  vi.spyOn(navigation, 'onWorkspace').mockReturnValue(true);
  vi.spyOn(billingApi, 'workspaceAccess').mockResolvedValue(pending ? { status: 'checkout_required', planId: 'basic', interval: 'monthly' } : { status: 'allowed' });
  const opening = transitionToWorkspace();
  await vi.advanceTimersByTimeAsync(3700);
  expect(getUi().transition.title).toBe(pending ? 'Cargando pasarela de pago' : 'Todo listo, Ana');
  expect(getUi().transition.open).toBe(true);
  await vi.advanceTimersByTimeAsync(1900);
  await opening;
  expect(getUi().transition.open).toBe(false);
});
