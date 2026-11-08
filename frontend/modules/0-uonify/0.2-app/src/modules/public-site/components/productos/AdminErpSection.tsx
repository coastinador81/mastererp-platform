import { DeviceFrame } from '../common/DeviceFrame';

/** Administración (ERP) dentro de Uonify: capacidades reales ya disponibles en DEV
 *  (Clientes, Proveedores, Ventas, Compras). Ilustración: el personaje ERP del manual. */
const ADMIN: ReadonlyArray<{ t: string; d: string }> = [
  { t: 'Clientes', d: 'Ficha común, contactos y condiciones comerciales por empresa.' },
  { t: 'Proveedores', d: 'Ficha completa, contactos y condiciones de suministro.' },
  { t: 'Ventas', d: 'El listado y el detalle de tus ventas, al día.' },
  { t: 'Compras', d: 'De la solicitud a la orden y la factura de compra.' },
];

/** Sección «Administración (ERP)» de la página de Servicios. */
export function AdminErpSection() {
  return (
    <section className="erp-section wrap" id="administracion" aria-labelledby="erp-title">
      <div className="erp-intro">
        <img className="erp-character" src="/assets/product-icons/erp.png" width="150" height="150" alt="El personaje de ERP de Uonify" loading="lazy" />
        <div>
          <p className="eyebrow">Gestión empresarial · ERP</p>
          <h2 id="erp-title">Ahora, también gestionas tu negocio.</h2>
          <p>Uonify suma la administración de tu empresa a lo que ya hacías. Clientes, proveedores, ventas y compras, en el mismo sitio y con Uony cerca.</p>
        </div>
      </div>
      <div className="erp-grid">
        {ADMIN.map(item => (
          <article className="erp-tile" key={item.t}>
            <h3>{item.t}</h3>
            <p>{item.d}</p>
            <span className="erp-pill">Disponible</span>
          </article>
        ))}
      </div>
      <div className="alt-section">
        <div className="alt-copy">
          <p className="kicker">Administración</p>
          <h2>Una ficha común para clientes y proveedores.</h2>
          <p>Datos, contactos y condiciones comerciales por empresa, con el mismo rigor que el resto de Uonify y bajo tu control.</p>
          <ul>
            <li>Alta, edición y búsqueda, con persistencia real.</li>
            <li>Ventas y compras (solicitud, orden y factura).</li>
            <li>Seguridad y aislamiento por empresa.</li>
          </ul>
        </div>
        <div className="alt-media">
          <DeviceFrame illo="erp" label="Administración en Uonify" alt="Administración en Uonify" />
        </div>
      </div>
    </section>
  );
}
