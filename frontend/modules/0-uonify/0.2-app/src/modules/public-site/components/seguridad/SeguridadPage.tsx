import { Link } from 'react-router';
import type { ReactNode } from 'react';
import productosCss from '../../styles/pages/productos.css?inline';
import seguridadCss from '../../styles/pages/seguridad.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { SiteFooter } from '../footer/SiteFooter';

const SHEETS = viewSheets(productosCss, seguridadCss);

function DoCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="do-card">
      <span className="ico">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/** Seguridad (`/seguridad`): qué hace Uonify con tus datos y el Uso Limitado de Google. */
export function SeguridadPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.seguridad} sheets={SHEETS}>
      <PageHeader current="seguridad" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="sec-hero wrap" aria-labelledby="sec-title">
          <p className="eyebrow">SEGURIDAD Y CONFIANZA</p>
          <h1 id="sec-title">Tus cuentas son tu negocio. <span>Las tratamos como tal.</span></h1>
          <p className="lead">Uony solo hace lo que le autorizas, y tú ves y controlas cada permiso. Esto es lo que hacemos para cuidar tus datos y tus conexiones.</p>
        </section>

        <section className="do-grid wrap" aria-label="Lo que hacemos">
          <DoCard title="Tú autorizas cada acción" icon={<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}>
            Uony solo lee lo que le dices y te pide tu visto bueno antes de publicar o de gastar. Nada se hace a tus espaldas.
          </DoCard>
          <DoCard title="Google Drive, archivo a archivo" icon={<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13l2 2 4-4" /></svg>}>
            Uony solo consulta los archivos que tú eliges para preparar tus productos; no los modifica ni los borra, y no mira tus carpetas.
          </DoCard>
          <DoCard title="Tus claves no salen del servidor" icon={<svg viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}>
            Las conexiones con Google y con tu cuenta de vendedor de Amazon se guardan en el servidor de Uonify, nunca en tu navegador.
          </DoCard>
          <DoCard title="Tú decides cuándo irte" icon={<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>}>
            Desconectas una cuenta o borras la tuya desde Configuración, y puedes pedir una copia de tus datos escribiéndonos.
          </DoCard>
        </section>

        <section className="limited wrap" id="datos-google" aria-labelledby="limited-title">
          <h2 id="limited-title">Uso de los datos de Google</h2>
          <p>El uso que Uonify hace de la información recibida mediante los permisos de Google Workspace, incluido Google Drive, se ajusta a la Política de Datos de Usuario de los Servicios de las API de Google, incluidos los requisitos de Uso Limitado.</p>
          <p>No usamos esos datos para entrenar ni mejorar modelos de inteligencia artificial, salvo lo estrictamente necesario para tu propia tarea.</p>
          <p className="en">Uonify's use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.</p>
          <Link className="text-link" to={PATHS.privacidad}>Lee la política de privacidad <span aria-hidden="true">↗</span></Link>
        </section>

        <section className="age wrap" aria-label="Para mayores de edad">
          <p>Uonify es para mayores de edad. Las funciones de inteligencia artificial no están disponibles para menores.</p>
        </section>
      </main>
      <SiteFooter />
    </PublicView>
  );
}
