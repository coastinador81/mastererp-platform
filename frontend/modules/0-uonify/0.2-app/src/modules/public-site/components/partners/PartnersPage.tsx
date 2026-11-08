import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import productosCss from '../../styles/pages/productos.css?inline';
import partnersCss from '../../styles/pages/partners.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';

const SHEETS = viewSheets(productosCss, partnersCss);

/** Distribuidores oficiales (solo los confirmados por el dueño). `logo` se añade con el
 *  material oficial autorizado; sin él se muestra el nombre, nunca un logo copiado. */
interface Partner { name: string; country: string; logo?: string }
const PARTNERS: readonly Partner[] = [
  { name: 'Ética y Servicios en Redes C.A.', country: 'Venezuela' },
  { name: 'BigBuy', country: 'España' },
];

/** Qué hace un partner autorizado (modelo tipo AWS Partner Network). */
const STEPS: ReadonlyArray<{ t: string; d: string }> = [
  { t: 'Implantan Uonify', d: 'Ponen en marcha la plataforma adaptada a tu operación y tus canales.' },
  { t: 'Hacen el onboarding', d: 'Acompañan los primeros pasos y la formación de tu equipo.' },
  { t: 'Te acompañan', d: 'Soporte cercano y continuo, en tu idioma y tu mercado.' },
];

/** Partners (`/partners`): programa de partners autorizados, directorio y solicitud. */
export function PartnersPage() {
  const [sent, setSent] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const honey = (form.elements.namedItem('website_url') as HTMLInputElement | null)?.value;
    if (honey) return; // Trampa antispam: un bot rellena este campo oculto.
    setSent(true);
    form.reset();
  };
  return (
    <PublicView view={PUBLIC_VIEWS.partners} sheets={SHEETS}>
      <PageHeader current="partners" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="partner-hero wrap" aria-labelledby="partner-title">
          <p className="eyebrow">PROGRAMA DE PARTNERS</p>
          <h1 id="partner-title">Partners autorizados <span>de Uonify.</span></h1>
          <p className="lead">Empresas autorizadas por Uonify que implantan la herramienta, hacen el onboarding y acompañan a sus clientes. Tú trabajas con Uonify; un partner cercano te ayuda a sacarle todo el partido.</p>
        </section>

        <section className="partner-steps wrap" aria-label="Qué hace un partner">
          {STEPS.map(step => (
            <div className="pstep" key={step.t}>
              <h3>{step.t}</h3>
              <p>{step.d}</p>
            </div>
          ))}
        </section>

        <section className="partner-dir wrap" aria-labelledby="dir-title">
          <div className="section-heading">
            <p className="eyebrow">Distribuidores oficiales</p>
            <h2 id="dir-title">Nuestra red de partners.</h2>
          </div>
          <div className="pcards">
            {PARTNERS.map(partner => (
              <article className="pcard" key={partner.name}>
                <div className="plogo">
                  {partner.logo
                    ? <img src={partner.logo} alt={partner.name} loading="lazy" />
                    : <span className="plogo-name">{partner.name}</span>}
                </div>
                <h3>{partner.name}</h3>
                <p className="pmeta">{partner.country} · Partner autorizado</p>
              </article>
            ))}
          </div>
        </section>

        <section className="partner-apply wrap" aria-labelledby="apply-title" id="solicitar">
          <div className="section-heading">
            <p className="eyebrow">Únete al programa</p>
            <h2 id="apply-title">Solicitar ser partner autorizado.</h2>
            <p>Cuéntanos sobre tu empresa y tu mercado. Revisamos cada solicitud y te respondemos.</p>
          </div>
          <form className="pform" onSubmit={onSubmit} noValidate>
            <div className="pform-grid">
              <div className="pfield pfield-full"><label htmlFor="pf-empresa">Empresa <span className="req">*</span></label><input id="pf-empresa" name="empresa" required /></div>
              <div className="pfield"><label htmlFor="pf-pais">País o territorio <span className="req">*</span></label><input id="pf-pais" name="pais" required /></div>
              <div className="pfield"><label htmlFor="pf-web">Sitio web (opcional)</label><input id="pf-web" name="web" inputMode="url" placeholder="https://" /></div>
              <div className="pfield"><label htmlFor="pf-contacto">Persona de contacto <span className="req">*</span></label><input id="pf-contacto" name="contacto" required /></div>
              <div className="pfield"><label htmlFor="pf-cargo">Cargo (opcional)</label><input id="pf-cargo" name="cargo" /></div>
              <div className="pfield"><label htmlFor="pf-email">Email corporativo <span className="req">*</span></label><input id="pf-email" name="email" type="email" required /></div>
              <div className="pfield"><label htmlFor="pf-tel">Teléfono (opcional)</label><input id="pf-tel" name="telefono" inputMode="tel" /></div>
              <div className="pfield pfield-full"><label htmlFor="pf-tipo">Tipo de colaboración</label>
                <select id="pf-tipo" name="tipo" defaultValue="Implantación y onboarding">
                  <option>Implantación y onboarding</option>
                  <option>Reventa / distribución</option>
                  <option>Integración</option>
                  <option>Otro</option>
                </select></div>
              <div className="pfield pfield-full"><label htmlFor="pf-msg">Mensaje</label><textarea id="pf-msg" name="mensaje" rows={4} /></div>
            </div>
            <div className="pf-trap" aria-hidden="true">
              <label>No rellenar este campo<input tabIndex={-1} autoComplete="off" name="website_url" /></label>
            </div>
            <label className="pconsent"><input type="checkbox" name="consentimiento" required /><span>He leído la información de protección de datos y acepto que Uonify trate mis datos para gestionar mi solicitud de Partner y ponerse en contacto conmigo.</span></label>
            <div className="pf-actions"><button className="button primary" type="submit">Enviar solicitud</button></div>
            {sent && <p className="pf-sent" role="status">Gracias. Hemos recibido tu solicitud; te responderemos por correo.</p>}
            <p className="pf-note">Tu solicitud llega a nuestro equipo de partners. Protección antispam sin rastreadores de terceros.</p>
          </form>
          <div className="pform-dp" aria-label="Información de protección de datos">
            <h3>Protección de datos</h3>
            <p>Responsable: ETHICS CLOUD &amp; SECURITY SERVICES LLC, 4572 NW 114th Ave 1301, Doral, Florida 33178, EE.&nbsp;UU. Representante en la UE (art.&nbsp;27 RGPD): DataRep (Data Protection Representative Limited), Irlanda; puedes contactarlo en el formulario de <a className="text-link" href="https://www.datarep.com/data-request/" target="_blank" rel="noopener noreferrer">datarep.com/data-request</a> o en datarequest@datarep.com, indicando que tu solicitud es para Uonify. Contacto: privacidad@uonify.com.</p>
            <ul>
              <li><strong>Finalidad:</strong> gestionar y evaluar tu solicitud para ser Partner autorizado y ponernos en contacto contigo.</li>
              <li><strong>Base jurídica:</strong> la aplicación de medidas precontractuales a petición tuya y nuestro interés legítimo en evaluar posibles colaboraciones.</li>
              <li><strong>Destinatarios:</strong> no cedemos tus datos; solo los tratan, por nuestra cuenta, los proveedores que nos dan alojamiento y correo. Tu solicitud se envía a partners@uonify.com.</li>
              <li><strong>Conservación:</strong> durante la evaluación y, si no hay colaboración, hasta 1 año para atender consultas relacionadas; si colaboramos, mientras dure la relación y los plazos legales. Guardamos la fecha, tu dirección IP (o un valor equivalente) y la versión de este texto para acreditar tu solicitud.</li>
              <li><strong>Tus derechos:</strong> acceso, rectificación, supresión, oposición, limitación y portabilidad, escribiendo a privacidad@uonify.com; y reclamar ante la autoridad de control (en España, la AEPD, aepd.es). Estés donde estés, puedes ejercer los derechos que te reconozca tu ley.</li>
              <li>Más información en la <Link className="text-link" to={PATHS.privacidad}>Política de privacidad</Link>.</li>
            </ul>
          </div>
        </section>
      </main>
      <PageFooter links={SITE_FOOTER_LINKS} note="Uonify · Programa de partners." />
    </PublicView>
  );
}
