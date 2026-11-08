import { ClientProduct } from '../common/ClientProduct';
import { Link } from 'react-router';
import { PATHS } from '../../model/views';

/** «Varias marcas, varios canales» con la interfaz actual del catálogo. */
export function EnterpriseHero() {
  return (
    <section className="enterprise-hero wrap" aria-labelledby="enterprise-title">
      <div className="enterprise-hero-copy">
        <p className="eyebrow">UONIFY PARA EQUIPOS Y MARCAS</p>
        <h1 id="enterprise-title">Varias marcas, varios canales.{' '}<br /><span>Un mismo sitio para trabajarlos.</span></h1>
        <p className="enterprise-lead">Si llevas más de una marca o vendes en más de un canal, Uonify reúne tus productos y tu contenido en un solo espacio, y Uony te ayuda a prepararlos para cada destino.</p>
        <div className="enterprise-actions">
          <a className="button primary" href="#contacto">Habla con nosotros <span aria-hidden="true">↗</span></a>
          <Link className="button secondary" to={PATHS.productos}>Ver los servicios</Link>
        </div>
      </div>
      <div className="enterprise-interface"><ClientProduct /></div>
    </section>
  );
}
