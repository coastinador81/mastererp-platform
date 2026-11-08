import { Link } from 'react-router';
import { settingsPath } from '@/modules/settings';
import { Icon } from '@/shared/ui';

/** Dónde se eligen qué avisos llegan y por dónde (Configuración › Cuenta). */
export const PREFERENCES_TARGET = { pathname: settingsPath('cuenta'), hash: 'notificaciones' } as const;

/**
 * «Marcar todo como leído». Con todo leído queda con aria-disabled (no disabled),
 * para que el foco no se pierda justo después de pulsarlo.
 */
export function MarkAllButton({ unread, onClick }: { unread: number; onClick: () => void }) {
  const idle = unread <= 0;
  return (
    <button
      type="button"
      className="pim-btn pim-btn-ghost pim-btn-sm ntf-mark-all"
      aria-disabled={idle || undefined}
      onClick={() => { if (!idle) onClick(); }}
    >
      <Icon name="ntf-check-all" size={14} />
      Marcar todo como leído
    </button>
  );
}

export function PreferencesLink({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Link className="ntf-prefs" to={PREFERENCES_TARGET} onClick={onNavigate}>
      <Icon name="settings" size={15} />
      Preferencias de notificaciones
    </Link>
  );
}
