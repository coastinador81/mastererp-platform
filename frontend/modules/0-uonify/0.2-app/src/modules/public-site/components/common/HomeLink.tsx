import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { sessionHomePath, startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { PATHS } from '../../model/views';

type HomeLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** Destino público (la portada o `/#composer`). */
  to?: string;
  /** Logotipo de Uonify: su nombre accesible cambia con la sesión. */
  brand?: boolean;
};

const modified = (event: MouseEvent) => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Enlace «a casa» ([data-uonify-home] del PROTO): sin sesión lleva a la portada;
 * con sesión, al espacio; con el alta a medias, auth abre el alta.
 */
export function HomeLink({ to = PATHS.home, brand = false, onClick, ...rest }: HomeLinkProps) {
  const { status, links } = usePublicSession();
  const navigate = useNavigate();
  const target = sessionHomePath(status, to);
  const label = brand && status !== 'loading' ? links.homeLabel : rest['aria-label'];
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || modified(event)) return;
    event.preventDefault();
    if (status === 'onboarding') startAccess();
    else navigate(target);
  };
  return <Link {...rest} to={target} aria-label={label} data-uonify-home="" onClick={handleClick} />;
}
