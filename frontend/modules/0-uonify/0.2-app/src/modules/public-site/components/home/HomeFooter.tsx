import { Link } from 'react-router';
import { PATHS } from '../../model/views';

/** Pie de la portada con enlaces de descubrir y legales. */
export function HomeFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Descubrir Uonify">
        <Link to={PATHS.paraEmpresas}>Para equipos y marcas</Link>
        <Link to={PATHS.comoFunciona}>Cómo funciona Uonify</Link>
      </nav>
      <nav aria-label="Legal">
        <Link to={PATHS.privacidad}>Privacidad</Link>
        <Link to={PATHS.terminos}>Condiciones</Link>
      </nav>
    </footer>
  );
}
