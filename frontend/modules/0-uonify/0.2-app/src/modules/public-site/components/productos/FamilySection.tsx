import { Link } from 'react-router';
import { PATHS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { FAMILY } from './productosContent';
import { SERVICES, type ServiceCard } from './servicesContent';

function ServiceDetails({ service }: { service: ServiceCard }) {
  return (
    <details>
      <summary>Qué aportará <span aria-hidden="true">+</span></summary>
      <p>{service.details}</p>
    </details>
  );
}

function Service({ service }: { service: ServiceCard }) {
  const className = ['service', `service-${service.layout}`, service.tone].filter(Boolean).join(' ');
  const promise = <p className="service-promise">{service.promise[0]}<br />{service.promise[1]}</p>;
  const image = <img src={`/assets/productos/${service.image}.png`} width="800" height="800" alt={service.alt} loading="lazy" />;
  if (service.layout === 'wide') {
    return (
      <article className={className} id={service.id}>
        <div className="service-copy">
          <span className="development">Servicio Uonify</span><h3>{service.title}</h3>{promise}<p>{service.copy}</p><ServiceDetails service={service} />
        </div>
        {image}
        <div className="service-keywords">{service.keywords?.map(word => <span key={word}>{word}</span>)}</div>
      </article>
    );
  }
  return (
    <article className={className} id={service.id}>
      <span className="development">Servicio Uonify</span><h3>{service.title}</h3>{promise}{image}<p>{service.copy}</p><ServiceDetails service={service} />
      {service.alias ? <span id={service.alias} className="anchor-alias"></span> : null}
    </article>
  );
}

/** «Un universo que crece contigo»: los servicios de Uonify. */
export function FamilySection() {
  return (
    <section className="family-section wrap" id="herramientas" aria-labelledby="family-title">
      <div className="section-heading">
        <p className="eyebrow">UN UNIVERSO QUE CRECE CONTIGO</p>
        <h2 id="family-title">Cada necesidad,{' '}<br />una herramienta con carácter.</h2>
        <p>Cada servicio se activa en tu espacio Uonify y trabaja junto a Uony, con la misma información de tus productos.</p>
      </div>
      <div className="family-editorial">
        {SERVICES.map(service => <Service key={service.id} service={service} />)}
      </div>
    </section>
  );
}

/** «Empieza con una idea» y el directorio «Encuentra tu herramienta». */
export function StartAndExplore() {
  return (
    <>
      <section className="start-section wrap" id="empezar" aria-labelledby="start-title">
        <p className="eyebrow">HERRAMIENTAS AL ALCANCE DE MÁS PERSONAS</p>
        <h2 id="start-title">Empieza con una idea.{' '}<br /><span>Crece con lo que haces.</span></h2>
        <p>Empieza con una suscripción única y todas las herramientas.{' '}<br />Y haz crecer tu trabajo a tu ritmo, pagando a Google solo lo que uses.</p>
        <div className="start-actions">
          <HomeLink className="button primary" to={PATHS.composer}>Empieza con Uony <span aria-hidden="true">↗</span></HomeLink>
          <Link className="button secondary" to={PATHS.precios}>Ver precios</Link>
        </div>
      </section>
      <section className="explore-section wrap" id="explorar" aria-labelledby="explore-title">
        <div className="explore-heading"><h2 id="explore-title">Encuentra tu herramienta.</h2><p>Todo el universo Uonify, a un clic.</p></div>
        <div className="product-directory">
          {FAMILY.map(item => (
            <a key={item.id} href={`#${item.id}`}><img src={`/assets/product-icons/${item.icon}.png`} width="68" height="68" alt="" /><span>{item.label}</span></a>
          ))}
        </div>
      </section>
    </>
  );
}
