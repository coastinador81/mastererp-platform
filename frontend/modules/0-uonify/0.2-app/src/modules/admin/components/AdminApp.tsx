import { Spinner } from '@/shared/ui';
import { useAdminSession, useSessionExpiry } from '../hooks/useAdminSession';
import { QueryState } from './common/PageParts';
import { AdminLayout } from './layout/AdminLayout';
import { AdminSignIn } from './signin/AdminSignIn';
import './icons';
import '../styles/index.css';

/**
 * Raíz de /admin/*: sin sesión del panel enseña el acceso del equipo en la misma
 * dirección; con sesión, la maqueta y la sección pedida. Nunca se indexa.
 */
export function AdminApp() {
  useSessionExpiry();
  const session = useAdminSession();
  return (
    <>
      <title>Panel de administración · Uonify</title>
      <meta name="robots" content="noindex, nofollow" />
      {session.isPending ? (
        <div className="adm-boot">
          <Spinner label="Abriendo el panel…" />
        </div>
      ) : session.isError ? (
        <div className="adm-boot">
          <QueryState isPending={false} error={session.error} onRetry={() => void session.refetch()} />
        </div>
      ) : session.data.authenticated && session.data.member ? (
        <AdminLayout member={session.data.member} />
      ) : (
        <AdminSignIn />
      )}
    </>
  );
}
