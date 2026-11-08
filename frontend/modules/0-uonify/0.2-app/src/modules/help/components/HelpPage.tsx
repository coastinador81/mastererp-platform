import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Field, Input } from '@/shared/ui';
import { PATHS, useSeoHead, useViewStyles } from '@/modules/public-site';
import { SEED_ARTICLES, SEED_COLLECTIONS } from '../content';
import { buildIndex, search } from '../model/search';
import { ArticleBody } from './ArticleBody';
import css from './help.css?inline';

const sheets = [css];
const index = buildIndex(SEED_ARTICLES);

/** Cabecera común de la web pública (logotipo, menú y acceso), con «Ayuda» activo. */
function HelpHeader() {
  return (
    <header className="hlp-site-header">
      <Link className="hlp-brand" to="/" aria-label="Uonify, inicio">
        <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="126" height="40" alt="Uonify" />
      </Link>
      <nav className="hlp-site-nav" aria-label="Navegación principal">
        <Link to={PATHS.comoFunciona}>Cómo funciona</Link>
        <Link to={PATHS.productos}>Servicios</Link>
        <Link to={PATHS.loQuePuedesHacer}>Lo que puedes hacer</Link>
        <Link to={PATHS.precios}>Precios</Link>
        <Link to="/ayuda" aria-current="page">Ayuda</Link>
      </nav>
      <Link className="hlp-login" to="/espacio">Iniciar sesión</Link>
    </header>
  );
}

/** Pie común de la web pública. */
function HelpFooter() {
  return (
    <footer className="hlp-site-footer">
      <nav aria-label="Enlaces del pie">
        <Link to={PATHS.comoFunciona}>Cómo funciona</Link>
        <Link to={PATHS.productos}>Servicios</Link>
        <Link to={PATHS.loQuePuedesHacer}>Lo que puedes hacer</Link>
        <Link to={PATHS.precios}>Precios</Link>
        <Link to="/ayuda">Ayuda</Link>
        <Link to={PATHS.seguridad}>Seguridad</Link>
        <Link to={PATHS.sobreUonify}>Sobre Uonify</Link>
        <Link to={PATHS.privacidad}>Privacidad</Link>
        <Link to={PATHS.terminos}>Condiciones</Link>
      </nav>
      <p>Google Drive, Gemini, Veo, Nano Banana, Lyria y Google Cloud son marcas de Google LLC. «Amazon and all related marks are trademarks of Amazon.com, Inc. or its affiliates.» Uonify no está afiliada, patrocinada ni respaldada por Google ni por Amazon.</p>
    </footer>
  );
}

/** Bloque de soporte: Uony de ayuda, correo y videollamada de pago. */
function SupportBlock() {
  return (
    <section className="hlp-support" aria-labelledby="hlp-support-title">
      <h2 id="hlp-support-title" className="hlp-eyebrow">Cómo te ayudamos</h2>
      <div className="hlp-support-grid">
        <div className="hlp-support-card">
          <h3>Uony de ayuda</h3>
          <p>Pregúntale a Uony en tu espacio. Responde con estas guías y, si no puede, te deriva al equipo. Para clientes, con tu cuenta.</p>
          <Link className="hlp-btn-solid" to="/espacio">Abrir Uony de ayuda</Link>
        </div>
        <div className="hlp-support-card">
          <h3>Correo</h3>
          <p>Escríbenos a <a className="hlp-link" href="mailto:hola@uonify.com">hola@uonify.com</a> desde el correo de tu cuenta. Te respondemos por orden de llegada.</p>
        </div>
        <div className="hlp-support-card">
          <h3>Videollamada <span className="hlp-tag">De pago</span></h3>
          <p>Reserva una sesión con un experto para revisar tu caso contigo.</p>
        </div>
      </div>
    </section>
  );
}

/** Centro de ayuda público (`/ayuda` y `/ayuda/:slug`). */
export function HelpPage() {
  useViewStyles('help', sheets);
  const { slug } = useParams();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const article = SEED_ARTICLES.find(a => a.slug === slug);
  const title = article?.title ?? (slug ? 'Artículo no encontrado' : 'Centro de ayuda');
  useSeoHead({
    path: slug ? `/ayuda/${slug}` : '/ayuda',
    title: `${title} · Uonify`,
    description: article?.summary ?? 'Guías y respuestas sobre Uonify: acceso, tu suscripción, lo que pagas a Google, tus productos y Uony. Y, si lo necesitas, el soporte de nuestro equipo.',
  });
  const results = q.trim() ? search(index, q) : [];
  return (
    <div className="hlp-shell">
      <HelpHeader />
      <main id="contenido" className="hlp-page" tabIndex={-1}>
        {article ? (
          <article className="hlp-article">
            <p className="hlp-crumbs"><Link to="/ayuda">Centro de ayuda</Link> › {title}</p>
            <h1>{title}</h1>
            <p className="hlp-article-summary">{article.summary}</p>
            <ArticleBody body={article.body} />
          </article>
        ) : slug ? (
          <div className="hlp-notfound"><h1>{title}</h1><p>El artículo no está disponible. <Link to="/ayuda">Consulta el centro de ayuda</Link>.</p></div>
        ) : (
          <>
            <section className="hlp-hero">
              <p className="hlp-eyebrow">Centro de ayuda</p>
              <h1>¿En qué te ayudamos?</h1>
              <p className="hlp-lead">Guías y respuestas para trabajar con Uony, conectar tus cuentas y sacar partido a Uonify.</p>
            </section>
            <SupportBlock />
            <section className="hlp-search" aria-label="Buscar en la ayuda">
              <Field label="Busca en la ayuda"><Input type="search" value={q} placeholder="Por ejemplo: conectar Amazon" onChange={e => setQ(e.target.value)} /></Field>
            </section>
            {q.trim() ? (
              <section className="hlp-results" aria-label="Resultados">
                <p role="status">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</p>
                <div className="hlp-grid">{results.map(a => <article className="hlp-card" key={a.slug}><h2><Link to={`/ayuda/${a.slug}`}>{a.title}</Link></h2><p>{a.summary}</p></article>)}</div>
              </section>
            ) : (
              <section className="hlp-topics" aria-labelledby="hlp-topics-title">
                <h2 id="hlp-topics-title" className="hlp-eyebrow">Explora por temas</h2>
                <p className="hlp-topics-lead">Ocho colecciones con todo lo que puedes hacer en Uonify.</p>
                <div className="hlp-grid">
                  {SEED_COLLECTIONS.map(collection => (
                    <section className="hlp-card" key={collection.id} id={`coleccion-${collection.id}`}>
                      <h3>{collection.title}</h3>
                      <p>{collection.description}</p>
                      <ul>{SEED_ARTICLES.filter(a => a.metadata.collection === collection.id).map(a => <li key={a.slug}><Link to={`/ayuda/${a.slug}`}>{a.title}</Link></li>)}</ul>
                    </section>
                  ))}
                </div>
              </section>
            )}
            <p className="hlp-ai-note">¿Usas un asistente de IA? Esta ayuda está muy documentada y estructurada para que también puedas consultarla desde asistentes de inteligencia artificial externos.</p>
          </>
        )}
      </main>
      <HelpFooter />
    </div>
  );
}
