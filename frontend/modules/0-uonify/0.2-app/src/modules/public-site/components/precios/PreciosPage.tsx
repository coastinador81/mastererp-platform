import productosCss from '../../styles/pages/productos.css?inline';
import preciosCss from '../../styles/pages/precios.css?inline';
import richCss from '../../styles/pages/rich.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { formatEuros, MONTHLY_NET_EUR, MONTHLY_PRICE_EUR, YEARLY_NET_EUR, YEARLY_PRICE_EUR } from '../../model/seo/plans';
import { HomeLink } from '../common/HomeLink';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';

const SHEETS = viewSheets(productosCss, preciosCss, richCss);

/** Lo que incluye la suscripción. */
const INCLUDES: readonly string[] = [
  'Uony por escrito, y por voz cuando esté disponible.',
  'Tus productos y sus fichas.',
  'El Estudio: imágenes y vídeos con inteligencia artificial.',
  'Tus conexiones: Amazon, Google Drive™ y tu proyecto de Google.',
  'Centro de ayuda y soporte: Uony de ayuda, correo y videollamada de pago con un experto.',
];

/** Preguntas frecuentes (visibles en la página). */
const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  { q: '¿Hay un plan gratuito?', a: 'No. Uonify es de pago desde que entras. Tienes 14 días para darte de baja: te devolvemos tu cuota, menos los días que la hayas usado.' },
  { q: '¿Cómo me doy de baja?', a: 'Desde tu cuenta, cuando quieras. En los primeros 14 días te devolvemos tu cuota menos los días que la hayas usado; después, conservas el acceso hasta el final del periodo que ya pagaste.' },
  { q: '¿El pago anual es más barato?', a: 'Es el mismo precio: 118,80 € al año + IVA equivale a 9,90 € al mes + IVA. En España, 143,75 € al año o 11,98 € al mes con el IVA incluido. Eliges cómo prefieres pagar.' },
  { q: '¿Cuánto cuesta un vídeo o una imagen?', a: 'Depende de la pieza. Uony te enseña el precio máximo en euros antes de crearla, y lo pagas a Google con tu proyecto.' },
  { q: '¿Necesito una cuenta de Google?', a: 'Sí, para crear imágenes y vídeos y para trabajar con tus archivos de Google Drive. Entras en Uonify con tu cuenta de Google.' },
];

/** Isotipo de la IA (ON) en aqua, para el bloque «Lo que pagas a Google». */
function UonyAquaMark() {
  return (
    <svg className="mark" viewBox="0 0 280 168" role="img" aria-label="Uony"><path fill="#008376" d="M133.709 17.292L246 103.95V0H275.75V165.75L115.535 41.161A53 53 0 1 0 134.949 72.5L165.015 95.75A83 83 0 1 1 133.709 17.292Z" /></svg>
  );
}

/** Precios (`/precios`): una suscripción única, y lo que se paga a Google. */
export function PreciosPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.precios} sheets={SHEETS}>
      <PageHeader current="precios" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="hero-split wrap" aria-labelledby="price-title">
          <div className="hero-copy">
            <p className="eyebrow">PRECIO DE UONIFY</p>
            <h1 id="price-title">Un plan. <span>Claro desde el principio.</span></h1>
            <p className="lead">Entra en Uonify y empieza a trabajar con Uony. Eliges pago mensual o anual, y tienes 14 días para darte de baja. Las imágenes y los vídeos los pagas a Google con tu proyecto, a sus precios.</p>
          </div>
          <div className="hero-illo hero-glow">
            <img src="/assets/product-icons/analitica.png" width="320" height="320" alt="Personaje de analítica de Uonify" fetchPriority="high" />
          </div>
        </section>

        <div className="plan-wrap wrap">
          <div className="plan">
            <h2 className="plan-name">Uonify</h2>
            <p className="plan-tag">Todas las herramientas y Uony.</p>
            <div className="amounts">
              <span className="amount">{formatEuros(MONTHLY_NET_EUR)}<small> / mes + IVA</small></span>
              <span className="year">o {formatEuros(YEARLY_NET_EUR)} al año + IVA</span>
            </div>
            <p className="vat">En España, {formatEuros(MONTHLY_PRICE_EUR)} al mes ({formatEuros(YEARLY_PRICE_EUR)} al año) con el IVA incluido. El precio final con el IVA de tu país se muestra antes de pagar.</p>
            <p className="vat vat-business">{formatEuros(MONTHLY_NET_EUR)} al mes sin IVA para empresas con número de IVA válido.</p>
            <ul className="includes">
              {INCLUDES.map(item => <li key={item}>{item}</li>)}
            </ul>
            <HomeLink className="button primary" to={PATHS.composer}>Empieza ahora</HomeLink>
            <p className="withdraw">Se paga al entrar. 14 días para darte de baja: te devolvemos tu cuota, menos los días que la hayas usado. Cancelas desde tu cuenta.</p>
            <p className="need">Para usar Uony y el Estudio necesitas tu propio proyecto de Google Cloud con la facturación activa. Google decide, según sus condiciones, quién puede abrir una cuenta de facturación. Te lo contamos antes de contratar.</p>
            <details className="hook">
              <summary>¿Nuevo en Google Cloud? 300 $ de crédito de Google · Ver condiciones</summary>
              <div className="hook-body">
                <p>Google ofrece a sus clientes nuevos de Google Cloud 300 $ de crédito de prueba durante 90 días, según sus condiciones. Es una oferta de Google, no de Uonify.</p>
                <p>Puede no cubrir todos los modelos ni todos los usos. Cuando el crédito se agota, Google detiene el proyecto y Uony deja de crear imágenes y vídeos hasta que actives el pago en tu cuenta de Google.</p>
                <p>Consulta las condiciones y la disponibilidad en <a className="text-link" href="https://cloud.google.com/free" target="_blank" rel="noopener noreferrer">cloud.google.com/free</a>.</p>
              </div>
            </details>
          </div>
        </div>

        <section className="google-pay wrap" aria-labelledby="google-pay-title">
          <UonyAquaMark />
          <h2 id="google-pay-title">Las imágenes y los vídeos los pagas a Google.</h2>
          <p>Las imágenes y los vídeos se crean con la tecnología de Google —Veo para el vídeo, Nano Banana para las imágenes— en tu propio proyecto de Google, y los pagas directamente a Google. Uonify no cobra por encima.</p>
          <p>Antes de crear cada pieza, Uony te enseña su precio máximo en euros y te pide tu visto bueno. El importe exacto aparece en tu factura de Google.</p>
          <p>Hablar con Uony y guardar tus planes no tiene coste.</p>
        </section>

        <section className="faq wrap" aria-labelledby="faq-title">
          <h2 id="faq-title">Preguntas frecuentes</h2>
          {FAQ.map(item => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </section>
      </main>
      <PageFooter links={SITE_FOOTER_LINKS} note="Uonify · Hazlo posible." />
    </PublicView>
  );
}
