import { ClientProduct } from '../common/ClientProduct';

/** 01 / ORGANIZA: capturas de la ficha real con catálogo, ocho pestañas y Uony. */
export function FichaStory() {
  return (
    <article className="product-story">
      <div className="story-intro">
        <div><span className="story-number">01 / ORGANIZA</span><h3>Una ficha que reúne{' '}<br />todo lo importante.</h3></div>
        <p>Deja de buscar el dato correcto entre archivos. Reúne nombres, referencias, categorías, atributos y variantes en una ficha que crece con tu producto.</p>
      </div>
      <div className="workspace-stage"><ClientProduct /></div>
      <details className="feature-details">
        <summary>Todo lo que puedes reunir en tu ficha <span aria-hidden="true">+</span></summary>
        <div className="detail-columns">
          <p><strong>Un catálogo ordenado.</strong> Creación e importación de productos, búsqueda por nombre o referencia y organización por categorías.</p>
          <p><strong>El detalle que necesitas.</strong> Atributos, campos personalizados, variantes y documentación del producto, sin separar la información de su contexto.</p>
          <p><strong>Preparado para crecer.</strong> Imágenes, descripciones, modelos 3D, stock y canales forman parte del espacio de cada producto.</p>
        </div>
      </details>
    </article>
  );
}
