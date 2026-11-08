import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import clsx from 'clsx';
import { useEventListener } from '@/shared/hooks';
import { Icon, IconButton } from '@/shared/ui';
import { AdminMemberContext, useSignOut } from '../../hooks/useAdminSession';
import { canView, ROLE_LABELS } from '../../model/permissions';
import type { TeamMember } from '../../model/types';
import { ADMIN_BASE, ADMIN_NAV, sectionOf } from './navItems';

/**
 * Maqueta propia del panel (sin la del espacio): menú lateral en escritorio y cajón en
 * móvil, con la persona del equipo y «Salir» al pie.
 */
export function AdminLayout({ member }: { member: TeamMember }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const section = sectionOf(pathname);
  const previousSection = useRef(section);

  // Al cambiar de sección, el foco va al contenido (lectores de pantalla y teclado).
  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    main.current?.focus({ preventScroll: true });
  }, [section]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) menuButton.current?.focus();
  };

  useEffect(() => {
    if (menuOpen) drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [menuOpen]);

  useEventListener('keydown', event => {
    if (menuOpen && event.key === 'Escape') closeMenu(true);
  });

  return (
    <AdminMemberContext.Provider value={member}>
      <div className={clsx('adm-shell', menuOpen && 'is-menu-open')}>
        <a className="skip-link" href="#adm-main">
          Saltar al contenido
        </a>
        <header className="adm-topbar">
          <IconButton
            ref={menuButton}
            icon="menu"
            label={menuOpen ? 'Cerrar el menú' : 'Abrir el menú'}
            tooltip={false}
            aria-expanded={menuOpen}
            aria-controls="adm-sidebar"
            onClick={() => (menuOpen ? closeMenu(false) : setMenuOpen(true))}
          />
          <Brand />
        </header>
        {menuOpen ? <div className="adm-scrim" aria-hidden="true" onClick={() => closeMenu(true)} /> : null}
        <aside id="adm-sidebar" ref={drawer} className="adm-sidebar" aria-label="Panel de administración">
          <Brand />
          <nav className="adm-nav" aria-label="Secciones del panel">
            {ADMIN_NAV.filter(item => canView(member.role, item.section)).map(item => (
              <NavLink key={item.section} to={item.path} end={item.path === ADMIN_BASE} onClick={() => closeMenu(false)}>
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <MemberFooter member={member} />
        </aside>
        <main id="adm-main" ref={main} className="adm-main" tabIndex={-1} inert={menuOpen || undefined}>
          {canView(member.role, section) ? <Outlet /> : <NoAccess />}
        </main>
      </div>
    </AdminMemberContext.Provider>
  );
}

function Brand() {
  return (
    <div className="adm-brand">
      <img src="/assets/brands/uonify-wordmark-3d.webp" alt="Uonify" width={104} height={22} />
      <span className="adm-brand-tag">Admin</span>
      
    </div>
  );
}

function MemberFooter({ member }: { member: TeamMember }) {
  const signOut = useSignOut();
  return (
    <div className="adm-member">
      <span className="adm-avatar" aria-hidden="true">
        {member.name.charAt(0)}
      </span>
      <span className="adm-member-label">
        <strong>{member.name}</strong>
        <small>
          {ROLE_LABELS[member.role]} · {member.email}
        </small>
      </span>
      <IconButton icon="adm-log-out" label="Salir del panel" tooltipPos="above" tooltipAlign="end" loading={signOut.isPending} onClick={() => signOut.mutate()} />
    </div>
  );
}

function NoAccess() {
  return (
    <div className="adm-page">
      <div className="adm-no-access" role="alert">
        <Icon name="shield" size={24} />
        <h1>No tienes acceso a esta sección</h1>
        <p>Tu rol no la incluye. Si la necesitas, pídeselo a un superadmin.</p>
      </div>
    </div>
  );
}
