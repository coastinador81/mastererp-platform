import productosCss from '../../styles/pages/productos.css?inline';
import paraEmpresasCss from '../../styles/pages/para-empresas.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PUBLIC_VIEWS } from '../../model/views';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { SiteFooter } from '../footer/SiteFooter';
import { EnterpriseHero } from './EnterpriseHero';

const SHEETS = viewSheets(productosCss, paraEmpresasCss);
/** Contacto comercial (decisión del dueño: hola@uonify.com), con el asunto preparado. */
const ENTERPRISE_CONTACT = 'mailto:hola@uonify.com?subject=Conversemos%20sobre%20Uonify%20para%20equipos%20y%20marcas';

/**
 * Lo que Uonify aporta hoy a equipos y marcas. Versión corta y verdadera
 * (D-WEB-PUBLICA-20261022): sin roles, permisos por equipo ni sistemas conectados que
 * todavía no existen; esas funciones se anunciarán cuando estén construidas.
 */
const BRINGS: readonly string[] = [
  'Un catálogo común para todas tus marcas.',
  'Fichas preparadas para tu cuenta de vendedor de Amazon y para tu tienda.',
  'Imágenes y vídeos con el Estudio, con el gasto bajo tu control.',
  'Uony, por escrito y, cuando esté disponible, por voz.',
];

/** Para equipos y marcas (`/para-empresas`): varias marcas y canales, un mismo sitio. */
export function ParaEmpresasPage() {
  return (
    <PublicView view={PUBLIC_VIEWS['para-empresas']} sheets={SHEETS}>
      <PageHeader current="para-empresas" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <EnterpriseHero />
        <section className="enterprise-brings wrap enterprise-section" aria-labelledby="brings-title">
          <div className="section-heading">
            <p className="eyebrow">LO QUE APORTA HOY</p>
            <h2 id="brings-title">Tus marcas y tus canales,{' '}<br /><span>en un mismo espacio.</span></h2>
            <p>Empieza con lo que ya tienes. Estas son las piezas con las que puedes trabajar hoy mismo.</p>
          </div>
          <ul className="brings-list">
            {BRINGS.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section className="enterprise-close wrap" id="contacto" aria-labelledby="close-title">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-isotipo-3d.webp" width="46" height="46" alt="" loading="lazy" />
          <p className="eyebrow">EMPECEMOS POR TU OPERACIÓN</p>
          <h2 id="close-title">Cuéntanos cómo trabajáis hoy{' '}<br /><span>y vemos qué podemos conectar.</span></h2>
          <p>Escríbenos y lo vemos juntos: cómo lleváis vuestras marcas, vuestros canales y vuestro contenido.</p>
          <div className="enterprise-actions">
            <a className="text-link" href={ENTERPRISE_CONTACT}>Escríbenos a hola@uonify.com <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </PublicView>
  );
}
