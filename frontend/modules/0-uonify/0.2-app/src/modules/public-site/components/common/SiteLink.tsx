import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { hrefKind } from '../../model/links';

type SiteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

/**
 * Enlace de la web pública: las rutas de la app navegan sin recargar (Link), las
 * anclas de la misma página y los enlaces externos (mailto:, recursos) son <a>.
 */
export function SiteLink({ to, ...rest }: SiteLinkProps) {
  if (hrefKind(to) === 'route') return <Link to={to} {...rest} />;
  return <a href={to} {...rest} />;
}
