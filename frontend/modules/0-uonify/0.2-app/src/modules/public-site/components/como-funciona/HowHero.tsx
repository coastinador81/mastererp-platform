import { UonyPreview } from '../common/UonyPreview';
import { HomeLink } from '../common/HomeLink';
import { PATHS } from '../../model/views';

/** «Dilo como lo piensas.»: una petición que recorre Uonify hasta un resultado. */
export function HowHero() {
  return (
    <section className="how-hero wrap" aria-labelledby="how-title">
      <div className="how-hero-copy">
        <p className="eyebrow">CÓMO FUNCIONA UONIFY</p>
        <h1 id="how-title">Dilo como lo piensas.{' '}<br /><span>Uony se encarga del cómo.</span></h1>
        <p className="how-lead">Empieza con lo que quieres conseguir. Uony reúne tu contexto, trabaja con las herramientas adecuadas y te devuelve cada resultado para que lo revises antes de darlo por bueno.</p>
        <div className="how-actions">
          <HomeLink className="button primary" to={PATHS.composer}>Empieza con Uony</HomeLink>
          <a className="button secondary" href="#recorrido">Ver el recorrido <span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <div className="hero-current-interface"><UonyPreview view="uony-revision" /></div>
    </section>
  );
}
