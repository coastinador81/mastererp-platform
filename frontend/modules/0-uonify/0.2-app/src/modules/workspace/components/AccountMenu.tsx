import { USE_MOCKS } from '@/shared/api/config';
import { useRef, type FocusEvent } from 'react';
import { flushSync } from 'react-dom';
import { closeAccountMenu, closeServices, openWorkspacePage } from '../hooks/actions';
import { setUi, useRegisterRef, useUiStore } from '../hooks/uiStore';
import { useDismissOnPointerDown } from '../hooks/useDismiss';
import { signOut, useAccountSummary } from './authBridge';
import { settingsPath } from './moduleBridge';
import { SettingsIcon, SignOutIcon } from './ShellIcons';

/**
 * Botón de cuenta arriba a la derecha y su menú de un clic (plantilla
 * #view-espacio): avatar, nombre, correo y plan, «Configuración» (la página
 * /espacio/configuracion/cuenta del módulo settings) y «Cerrar sesión» dentro del
 * mismo menú. Los datos y las acciones de la sesión son del módulo auth.
 */
export function AccountMenu({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const open = useUiStore(state => state.accountOpen);
  const account = useAccountSummary();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useRegisterRef('accountButton', button);

  useDismissOnPointerDown(open, [panel, button], closeAccountMenu);

  const toggle = () => {
    const next = !open;
    closeServices();
    flushSync(() => setUi({ accountOpen: next }));
    if (next) panel.current?.querySelector<HTMLElement>('button')?.focus();
  };
  // Si el foco sale del menú y de su botón, el menú se cierra.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) closeAccountMenu();
  };
  const openSettings = () => {
    if (onOpenSettings) { closeAccountMenu(); onOpenSettings(); }
    else openWorkspacePage(settingsPath('cuenta'));
  };

  return (
    <div className="account-anchor" onBlur={onBlur} onKeyDown={event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAccountMenu(); button.current?.focus(); }
    }}>
      <button
        ref={button}
        className="account-button"
        id="account-button"
        type="button"
        aria-expanded={open}
        aria-controls="account-menu"
        data-tooltip="Tu cuenta"
        data-tooltip-pos="below"
        data-tooltip-align="end"
        onClick={toggle}
      >
        <span className="account-avatar" aria-hidden="true">{account.initial}</span>
        <span className="sr-only">Cuenta: </span>
        <span className="sr-only">{account.name}</span>
      </button>
      <section ref={panel} className="account-popover composer-account-menu" id="account-menu" aria-label="Cuenta" hidden={!open}>
        {!USE_MOCKS && <p className="account-identity-label">Cuenta de Uonify</p>}
        <div className="account-menu-head">
          <span className="account-avatar" aria-hidden="true">{account.initial}</span>
          <span className="account-menu-id">
            <strong>{account.name}</strong>
            <small>{account.email}</small>
          </span>
        </div>
        <div className="account-menu-plan">
          <span>Plan actual</span>
          <strong>{account.planLabel}</strong>
        </div>
        <div className="account-menu-sep" role="separator" />
        <button className="account-menu-item" id="account-trigger" type="button" onClick={openSettings}>
          <SettingsIcon />
          Configuración
        </button>
        <button className="account-menu-item account-menu-signout" type="button" onClick={() => void signOut()}>
          <SignOutIcon />
          Cerrar sesión
        </button>
      </section>
    </div>
  );
}
