import { Navigate, Outlet, useLocation } from 'react-router';
import { AuthDialogs } from '@/modules/auth';
import { toAppHref } from '../model/links';

/**
 * Marco de la web pública: la vista activa y, una sola vez, los diálogos de acceso
 * del módulo auth (entrar, conectar, alta, cuenta y transición al espacio).
 */
export function PublicLayout() {
  return (
    <>
      <Outlet />
      <AuthDialogs />
    </>
  );
}

/** Redirige las URL del prototipo (`/index.html?view=…`, `/producto.html#…`) a sus rutas. */
export function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={toAppHref(`${pathname.replace(/^\/+/, '')}${search}${hash}`)} replace />;
}
