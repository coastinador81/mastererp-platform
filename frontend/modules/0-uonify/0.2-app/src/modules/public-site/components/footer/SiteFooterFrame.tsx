import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';

/**
 * Pantalla completa con el pie global como última franja (el dueño pide que el pie nunca se
 * oculte, tampoco con sesión). El contenido ocupa el resto de la altura y se desplaza por
 * dentro si no cabe. Es para las pantallas del espacio que no montan su marco (WorkspaceShell
 * ya lleva el pie en su columna): la puerta de acceso («Preparando tu espacio…», el error de
 * acceso y la baja pendiente) y la activación de la cuenta. Lo de dentro no pinta otro pie.
 */
export function SiteFooterFrame({ children }: { children: ReactNode }) {
  return (
    <div className="site-footer-frame">
      <div className="site-footer-frame__content">{children}</div>
      <SiteFooter />
    </div>
  );
}
