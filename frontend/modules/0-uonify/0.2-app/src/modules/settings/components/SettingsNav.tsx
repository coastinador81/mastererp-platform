import { NavLink } from 'react-router';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { SECTION_META, SETTINGS_SECTIONS, settingsPath } from '../model/sections';

export interface SettingsNavProps {
  /** Lista a pantalla completa (móvil, sin sección abierta). */
  asList?: boolean;
}

/**
 * Navegación de Configuración: columna a la izquierda en escritorio y lista con
 * descripción en móvil (como ChatGPT y Claude). NavLink marca aria-current="page".
 */
export function SettingsNav({ asList = false }: SettingsNavProps) {
  return (
    <nav className={clsx('uset-nav', asList && 'is-list')} aria-label="Secciones de Configuración">
      <ul>
        {SETTINGS_SECTIONS.map(id => {
          const meta = SECTION_META[id];
          return (
            <li key={id}>
              <NavLink to={settingsPath(id)} className="uset-nav-link" data-section={id}>
                <Icon name={meta.icon} size={16} />
                <span className="uset-nav-text">
                  <span className="uset-nav-label">{meta.label}</span>
                  {asList ? <span className="uset-nav-sub">{meta.description}</span> : null}
                </span>
                {asList ? <Icon name="chevron-right" size={16} className="uset-nav-chevron" /> : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
