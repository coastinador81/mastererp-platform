import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAuthRouting } from '../hooks/useAuthRouting';
import { useAuthUi } from '../state/authUi';
import { activeHost, claimHost, subscribeHosts } from '../state/hosts';
import { ConnectDialog } from './ConnectDialog';
import { ProfileDialog } from './ProfileDialog';
import { SignInDialog } from './SignInDialog';
import { WorkspaceTransition } from './WorkspaceTransition';
import '../styles/index.css';

/**
 * Anfitrión del acceso: velo, diálogos y capa de transición (prototipo: los
 * <dialog> de index.html). Se pinta una vez por maquetación, dentro del router.
 * Van fuera de #root, como en el prototipo iban fuera de #page-root, para poder
 * dejar la página inerte detrás.
 */
export function AuthDialogs() {
  const [id] = useState(() => Symbol('auth-host'));
  useLayoutEffect(() => claimHost(id), [id]);
  const active = useSyncExternalStore(subscribeHosts, activeHost, activeHost) === id;
  useAuthRouting();
  if (!active || typeof document === 'undefined') return null;
  return createPortal(<AuthLayer />, document.body);
}

function AuthLayer() {
  const surface = useAuthUi(state => state.surface);
  const transitionOpen = useAuthUi(state => state.transition.open);
  const revealing = useAuthUi(state => state.revealing);
  const focus = useAuthUi(state => state.focus);

  // Estado de la página detrás: sin desplazamiento, inerte y con la aparición del espacio.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('uon-onboarding-active', surface.active);
    html.classList.toggle('uon-transition-active', transitionOpen);
    html.classList.toggle('uon-workspace-revealing', revealing);
    document.getElementById('root')?.toggleAttribute('inert', surface.active || transitionOpen);
  }, [surface.active, transitionOpen, revealing]);
  useLayoutEffect(
    () => () => {
      document.documentElement.classList.remove('uon-onboarding-active', 'uon-transition-active', 'uon-workspace-revealing');
      document.getElementById('root')?.removeAttribute('inert');
    },
    [],
  );

  // Los flujos piden el foco por selector; se aplica cuando el paso ya está pintado.
  useLayoutEffect(() => {
    if (!focus) return;
    const target = typeof focus.target === 'string' ? document.querySelector<HTMLElement>(focus.target) : focus.target;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [focus]);

  return (
    <>
      <div
        id="uon-onboarding-surface"
        className={surface.leaving ? 'uon-onboarding-surface is-leaving' : 'uon-onboarding-surface'}
        aria-hidden="true"
        hidden={!surface.active}
      />
      <SignInDialog />
      <ConnectDialog />
      <ProfileDialog />
      <WorkspaceTransition />
    </>
  );
}
