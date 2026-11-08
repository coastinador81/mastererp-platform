import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useMediaQuery } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import { BillingSettingsSection } from '@/modules/billing';
import {
  isSettingsSection,
  SECTION_META,
  SETTINGS_BASE_PATH,
  settingsDocumentTitle,
  settingsPath,
  type SettingsSectionId,
} from '../model/sections';
import { AccountSection } from './account/AccountSection';
import { ConnectionsSection } from './connections/ConnectionsSection';
import { GpsrSection } from './gpsr/GpsrSection';
import { HelpSection } from './help/HelpSection';
import { PrivacySection } from './privacy/PrivacySection';
import { SecuritySection } from './security/SecuritySection';
import { SettingsNav } from './SettingsNav';
import { TeamSection } from './team/TeamSection';
import { UsageSection } from './usage/UsageSection';
import './icons';
import '../styles/index.css';

/** En móvil, Configuración es una lista y, al elegir, el detalle a pantalla completa. */
export const SETTINGS_NARROW_QUERY = '(max-width: 759px)';

function sectionContent(section: SettingsSectionId): ReactNode {
  switch (section) {
    case 'cuenta': return <AccountSection />;
    case 'seguridad': return <SecuritySection />;
    case 'conexiones': return <ConnectionsSection />;
    case 'uso': return <UsageSection />;
    case 'plan': return <BillingSettingsSection />;
    case 'usuarios': return <TeamSection />;
    case 'gpsr': return <GpsrSection />;
    case 'privacidad': return <PrivacySection />;
    case 'ayuda': return <HelpSection />;
  }
}

/**
 * Configuración (/espacio/configuracion/:section?): navegación por secciones a la
 * izquierda y contenido a la derecha; en móvil, lista y luego detalle con «Atrás».
 * Al cambiar de sección el foco va al título; al volver a la lista, a la sección
 * de la que se venía.
 */
export function SettingsPage() {
  const params = useParams();
  const narrow = useMediaQuery(SETTINGS_NARROW_QUERY);
  const requested = params.section;
  const section = isSettingsSection(requested) ? requested : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<SettingsSectionId | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    const before = document.title;
    return () => { document.title = before; };
  }, []);

  useEffect(() => {
    document.title = settingsDocumentTitle(section);
  }, [section]);

  useLayoutEffect(() => {
    if (mounted.current) {
      if (section) heading.current?.focus({ preventScroll: false });
      else if (previous.current) root.current?.querySelector<HTMLElement>(`[data-section="${previous.current}"]`)?.focus();
    }
    mounted.current = true;
    previous.current = section ?? previous.current;
  }, [section]);

  if (requested !== undefined && !section) return <Navigate to={SETTINGS_BASE_PATH} replace />;
  // En escritorio siempre hay una sección abierta: la primera es Cuenta.
  if (!section && !narrow) return <Navigate to={settingsPath('cuenta')} replace />;

  const meta = section ? SECTION_META[section] : null;
  const showNav = !narrow || !section;
  const showContent = Boolean(section);

  return (
    <div className={`uset-page${narrow ? ' is-narrow' : ''}`} ref={root}>
      {narrow && section ? (
        <Link to={SETTINGS_BASE_PATH} className="uset-back">
          <Icon name="arrow-left" size={16} />
          <span>Configuración</span>
        </Link>
      ) : (
        <h1 className="uset-page-title">Configuración</h1>
      )}
      <div className="uset-layout">
        {showNav ? <SettingsNav asList={narrow} /> : null}
        {showContent && meta && section ? (
          <div className="uset-content" key={section}>
            <header className="uset-section-head">
              <h2 className="uset-section-title" ref={heading} tabIndex={-1}>{meta.label}</h2>
              <p className="uset-section-sub">{meta.description}</p>
            </header>
            {sectionContent(section)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
