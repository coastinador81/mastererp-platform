import clsx from 'clsx';
import { FINANCE_MENU, FINANCE_ICON_PATHS, type Apartado, type FinanceIconName } from '../model/menu';
import type { ApartadoMode } from '../model/mode';

export function FinanceIcon({ name }: { name: FinanceIconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: FINANCE_ICON_PATHS[name] }} />;
}

/** Etiqueta de los apartados que no se abren: la del equipo («Pendiente», «Sin acceso») o «Próximamente». */
const tagOf = (item: Apartado, mode: ApartadoMode) =>
  item.status === 'pendiente' ? 'Pendiente' : mode === 'sin-acceso' ? 'Sin acceso' : 'Próximamente';

export interface FinanceMenuProps {
  openGroups: ReadonlySet<string>;
  current: string | null;
  /** Cómo se abre cada apartado (model/mode.ts). */
  modeOf: (route: string | undefined) => ApartadoMode;
  onToggleGroup: (number: string, open: boolean) => void;
  onOpenApartado: (route: string) => void;
}

/**
 * Menú de Finanzas → Administración dentro del panel lateral: los 5 grupos y sus
 * apartados del equipo, en su orden (model/menu.ts). Lo que ya está en Uonify se abre;
 * lo demás sale desactivado con su estado, como en el menú del equipo.
 */
export function FinanceMenu({ openGroups, current, modeOf, onToggleGroup, onOpenApartado }: FinanceMenuProps) {
  return (
    <nav className="erp-menu" aria-label="Administración">
      {FINANCE_MENU.map(group => (
        <details
          key={group.number}
          className="erp-menu-group"
          open={openGroups.has(group.number)}
          onToggle={event => onToggleGroup(group.number, event.currentTarget.open)}
        >
          <summary className="erp-menu-summary">
            <FinanceIcon name={group.icon} />
            <span>{group.name}</span>
          </summary>
          <ul className="erp-menu-list">
            {group.items.map(item => {
              const mode = modeOf(item.route);
              return (
              <li key={item.label}>
                {(mode === 'real' || mode === 'demo') && item.route ? (
                  <button
                    type="button"
                    className={clsx('erp-menu-item', item.route === current && 'is-active')}
                    aria-current={item.route === current ? 'page' : undefined}
                    onClick={() => onOpenApartado(item.route as string)}
                  >
                    <FinanceIcon name={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ) : (
                  <span className="erp-menu-item is-disabled" aria-disabled="true">
                    <FinanceIcon name={item.icon} />
                    <span>{item.label}</span>
                    <small>{tagOf(item, mode)}</small>
                  </span>
                )}
              </li>
              );
            })}
          </ul>
        </details>
      ))}
    </nav>
  );
}
