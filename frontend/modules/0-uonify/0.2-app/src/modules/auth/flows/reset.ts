import { queryClient } from '@/shared/api/queryClient';
import { configureTiming, type TransitionTiming } from '../model/timing';
import { resetAuthUi } from '../state/authUi';
import { resetHosts } from '../state/hosts';
import { resetAccessFlow } from './access';
import { resetBoot } from './boot';
import { resetFocus } from './focus';
import { resetNavigation } from './navigation';
import { resetProfileFlow } from './profile';
import { resetTransitionClock } from './transition';
import { resetWorkspaceFlow } from './workspace';

/**
 * Solo pruebas: deja el módulo como recién cargado (estado, contadores, sesión
 * en caché) y, si se indica, acorta los tiempos de la transición.
 */
export function resetAuthModule(timing?: Partial<TransitionTiming>): void {
  resetTransitionClock();
  resetAccessFlow();
  resetWorkspaceFlow();
  resetBoot();
  resetProfileFlow();
  resetFocus();
  resetNavigation();
  resetHosts();
  resetAuthUi();
  configureTiming(timing);
  queryClient.removeQueries({ queryKey: ['auth'] });
  document.documentElement.classList.remove('uon-onboarding-active', 'uon-transition-active', 'uon-workspace-revealing', 'uon-resolving-home');
}
