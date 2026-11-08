import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { PATHS, WORKSPACE_PATH } from '../../model/views';

/**
 * «Iniciar sesión ↗» de las páginas (.login-link): abre el acceso; con la sesión lista
 * lleva al espacio. Mientras se consulta la sesión conserva el texto de la página.
 */
export function LoginLink({ pageLabel }: { pageLabel: string }) {
  const { status, links } = usePublicSession();
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (status === 'ready') navigate(WORKSPACE_PATH);
    else startAccess();
  };
  return (
    <Link className="login-link" to={status === 'ready' ? WORKSPACE_PATH : PATHS.composer} onClick={onClick}>
      {status === 'loading' ? pageLabel : links.loginLink} <span aria-hidden="true">↗</span>
    </Link>
  );
}
