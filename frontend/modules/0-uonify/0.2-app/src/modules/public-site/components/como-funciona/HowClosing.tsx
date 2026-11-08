import { UonyPreview } from '../common/UonyPreview';
import { Link } from 'react-router';
import { PATHS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { HOW_TOASTS } from './howContent';

type ShowToast = (title: string, copy: string) => void;

/** 04 · REVISAR: las excepciones llegan a quien decide. */
export function ReviewStoryHow() {
  return (
    <section className="how-story review-story-how wrap" id="revisar" aria-labelledby="review-title">
      <div className="story-copy">
        <p className="eyebrow">04 · REVISAR</p>
        <h2 id="review-title">La automatización avanza.{' '}<br /><span>Las decisiones siguen siendo tuyas.</span></h2>
        <p>Uonify separa lo que puede resolverse con las reglas acordadas de aquello que requiere criterio. Así revisas excepciones, no miles de tareas iguales.</p>
      </div>
      <UonyPreview preview />
    </section>
  );
}

/** 05 · PUBLICAR, principios y cierre de la página. */
export function PublishAndClose({ showToast }: { showToast: ShowToast }) {
  return (
    <>
      <section className="how-story publish-story" id="publicar" aria-labelledby="publish-title">
        <div className="wrap publish-layout">
          <UonyPreview />
          <div className="story-copy">
            <p className="eyebrow">05 · PUBLICAR</p>
            <h2 id="publish-title">Un mismo producto.{' '}<br /><span>La forma que necesita cada destino.</span></h2>
            <p>Cuando apruebas el resultado, Uonify prepara la información para cada canal y mantiene una ficha común como referencia.</p>
            <button className="text-action" type="button" data-route-details onClick={() => showToast(HOW_TOASTS.routeTitle, HOW_TOASTS.routeCopy)}>
              Ver qué conserva el recorrido <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </section>
      <section className="how-principles wrap" aria-labelledby="principles-title">
        <div><p className="eyebrow">SIEMPRE PRESENTE</p><h2 id="principles-title">Más capacidad.{' '}<br /><span>Sin perder comprensión.</span></h2></div>
        <div className="principles-grid">
          <article><span>01</span><h3>Permisos visibles</h3><p>Sabes qué puede consultar y hacer cada conexión.</p></article>
          <article><span>02</span><h3>Resultados revisables</h3><p>Compara propuestas antes de aceptar un cambio.</p></article>
          <article><span>03</span><h3>Origen conservado</h3><p>Cada dato mantiene el vínculo con su fuente.</p></article>
          <article><span>04</span><h3>Decisiones trazables</h3><p>El recorrido deja constancia de cómo se llegó al resultado.</p></article>
        </div>
      </section>
      <section className="how-close wrap" aria-labelledby="close-title">
        <img src="/assets/product-icons/hive.png" width="110" height="110" alt="Agentes de Uonify" />
        <p className="eyebrow">TU ESPACIO UONIFY</p>
        <h2 id="close-title">Empieza con una petición.{' '}<br /><span>Descubre todo lo que puede poner en marcha.</span></h2>
        <p>Una forma más natural de trabajar con tus productos, tus herramientas y la inteligencia artificial.</p>
        <div className="how-actions">
          <HomeLink className="button primary" to={PATHS.composer}>Pruébalo en tu espacio <span aria-hidden="true">↗</span></HomeLink>
          <Link className="button secondary" to={PATHS.productos}>Explora Productos</Link>
        </div>
      </section>
    </>
  );
}
