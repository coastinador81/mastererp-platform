import type { ReactNode } from 'react';
import productosCss from '../../styles/pages/productos.css?inline';
import canDoCss from '../../styles/pages/lo-que-puedes-hacer.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { SiteFooter } from '../footer/SiteFooter';

const SHEETS = viewSheets(productosCss, canDoCss);

/** Iconos de línea de la página (definidos una vez; se referencian con <use>). */
function CanDoDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="cd-uony-g" gradientUnits="userSpaceOnUse" x1="246" y1="0" x2="30" y2="166">
          <stop offset="0" stopColor="#0473E6" /><stop offset=".5" stopColor="#0D87E4" /><stop offset=".625" stopColor="#29AEC9" /><stop offset="1" stopColor="#32BCC3" />
        </linearGradient>
        <symbol id="cd-uony" viewBox="0 0 280 168"><path fill="url(#cd-uony-g)" d="M133.709 17.292L246 103.95V0H275.75V165.75L115.535 41.161A53 53 0 1 0 134.949 72.5L165.015 95.75A83 83 0 1 1 133.709 17.292Z" /></symbol>
        <symbol id="cd-play" viewBox="0 0 24 24"><path d="M7 4v16l13-8Z" /></symbol>
        <symbol id="cd-image" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></symbol>
        <symbol id="cd-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></symbol>
        <symbol id="cd-arrow-down" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" /></symbol>
        <symbol id="cd-euro" viewBox="0 0 24 24"><path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" /></symbol>
        <symbol id="cd-check" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></symbol>
        <symbol id="cd-refresh" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></symbol>
        <symbol id="cd-library" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></symbol>
        <symbol id="cd-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></symbol>
        <symbol id="cd-box" viewBox="0 0 24 24"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></symbol>
        <symbol id="cd-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></symbol>
        <symbol id="cd-palette" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7h2c3 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2Z" /></symbol>
      </defs>
    </svg>
  );
}

/** Icono de línea (usa el símbolo cd-<id>). */
function I({ id, w = 18, h = 18 }: { id: string; w?: number; h?: number }) {
  return <svg className="i" width={w} height={h} aria-hidden="true"><use href={`#cd-${id}`} /></svg>;
}

/** Sello «Creado con Uony» (isotipo ON en degradado). */
function UonyMark({ label = true }: { label?: boolean }) {
  return (
    <span className={`ai${label ? '' : ' mark'}`}>
      <svg width="18" height="11" role="img" aria-label="Creado con Uony"><use href="#cd-uony" /></svg>{label ? 'Creado con Uony' : null}
    </span>
  );
}

interface SlotProps { pin: number; kind: string; ratio: string; title?: string; meta?: string; image?: boolean; small?: boolean; mark?: boolean; label?: boolean }
/** Hueco de medio (vídeo o imagen): marcador de una pieza que creará el Estudio. */
function Slot({ pin, kind, ratio, title, meta, image, small, mark, label = true }: SlotProps) {
  const [w, h] = ratio.split(':').map(Number);
  return (
    <div className={`slot${image ? ' img' : ''}${small ? ' small' : ''}`}>
      <svg className="ratio" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />
      <div className="inner">
        <div className="head">
          <span className="tag"><span className="pin">{pin}</span>{kind ? <span>{kind}</span> : null}</span>
          {label ? <UonyMark label={!mark} /> : null}
        </div>
        <span className="play"><I id={image ? 'image' : 'play'} w={22} h={22} /></span>
        {(title || meta) && <div className="cap">{title ? <strong>{title}</strong> : null}{meta ? <span className="meta">{meta}</span> : null}</div>}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return <li><span className="n">{n}</span><div><h3>{title}</h3>{children}</div></li>;
}

/** Lo que puedes hacer (`/lo-que-puedes-hacer`): dos recorridos y una galería de piezas. */
export function LoQuePuedesHacerPage() {
  return (
    <PublicView view={PUBLIC_VIEWS['lo-que-puedes-hacer']} sheets={SHEETS}>
      <CanDoDefs />
      <PageHeader current="lo-que-puedes-hacer" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="cd-hero wrap" aria-labelledby="cd-hero-title">
          <p className="eyebrow">LO QUE PUEDES HACER CON UONIFY</p>
          <h1 id="cd-hero-title">Siempre se puede empezar <span>desde cero.</span></h1>
          <p className="lead">Publica un producto en Amazon empezando por una idea. Crea imágenes y vídeos para tus redes con tus fotos o sin ellas. Se lo pides a Uony en la conversación y te pide tu visto bueno antes de cada paso.</p>
          <div className="actions">
            <HomeLink className="button primary" to={PATHS.composer}>Empieza con Uony <I id="arrow-right" /></HomeLink>
            <a className="text-link" href="#recorridos">Mira los dos recorridos <I id="arrow-down" /></a>
          </div>
          <div className="reel"><Slot pin={1} kind="Hueco de vídeo" ratio="16:9" title="Hecho con Uonify" meta="16:9 · 30-45 s · subtítulos" /></div>
          <p className="note">Todas las imágenes y los vídeos de esta página se han creado con Uonify, con la tecnología de Google. Ninguna persona que aparezca es real ni es menor de edad. Uonify es para mayores de edad.</p>
        </section>

        <section className="routes" id="recorridos" aria-label="Dos recorridos">
          <div className="wrap grid">
            <a className="route" href="#amazon">
              <img src="/assets/product-icons/catalogo.png" width="72" height="72" alt="" loading="lazy" />
              <div><span className="num">RECORRIDO 01</span><h3>Tu producto en Amazon, desde cero</h3><p>De una idea, o de tus archivos de Google Drive™, a una ficha lista para publicar, con sus imágenes y su vídeo.</p><span className="text-link">Ver el recorrido <I id="arrow-down" /></span></div>
            </a>
            <a className="route" href="#redes">
              <img src="/assets/product-icons/hive.png" width="72" height="72" alt="" loading="lazy" />
              <div><span className="num">RECORRIDO 02</span><h3>Contenido para tus redes, con o sin fotos</h3><p>Imágenes, vídeos verticales y anuncios a partir de tus fotos, o solo con tus palabras.</p><span className="text-link">Ver el recorrido <I id="arrow-down" /></span></div>
            </a>
          </div>
        </section>

        <section className="journey" id="amazon" aria-labelledby="amazon-title">
          <div className="wrap">
            <div className="intro">
              <p className="eyebrow">RECORRIDO 01 · AMAZON</p>
              <h2 id="amazon-title">Tu producto en Amazon, <span>desde cero.</span></h2>
              <p className="lead">Así se preparó Basic Mini Bricks: una conversación con Uony, de la idea a la ficha publicada.</p>
            </div>
            <div className="cols">
              <ol className="steps">
                <Step n="01" title="Cuéntaselo a Uony"><p>Escribe qué vendes y dónde tienes los archivos. Si no tienes nada, empieza con la idea.</p><span className="bubble">Quiero vender Basic Mini Bricks en Amazon. Te elijo las fotos de mi Google Drive.</span></Step>
                <Step n="02" title="Uony prepara la ficha"><p>Lee los archivos que le has elegido, completa los datos que pide Amazon y te pregunta solo lo que no encuentra.</p></Step>
                <Step n="03" title="Crea las imágenes y el vídeo"><p>En el Estudio, Uony te propone un plan escena a escena con su precio máximo. No se crea nada sin tu OK.</p></Step>
                <Step n="04" title="Revisa la vista previa"><p>Ves la ficha tal y como se enviará y apruebas ese envío exacto.</p></Step>
                <Step n="05" title="Publica en Amazon"><p>Uony te enseña la respuesta real de Amazon y lo que haya que corregir.</p><span className="cond">Se publica en la web cuando la publicación esté comprobada (AMZ-05 y AMZ-07)</span></Step>
              </ol>
              <div className="media">
                <Slot pin={2} kind="Hueco de vídeo" ratio="16:9" title="Vídeo para la ficha · Basic Mini Bricks" meta="16:9 · 720p · 24 s · Veo 3.1 Fast" />
                <div className="row3">
                  <Slot pin={3} kind="Imagen" ratio="1:1" image small title="Imagen principal" meta="1:1 · 1K · Nano Banana" />
                  <Slot pin={4} kind="Imagen" ratio="1:1" image small title="Ambiente" meta="1:1 · 1K · Nano Banana" />
                  <Slot pin={5} kind="Imagen" ratio="1:1" image small title="Infografía" meta="1:1 · 1K · Nano Banana" />
                </div>
                <div className="row2">
                  <Slot pin={6} kind="Hueco de vídeo" ratio="16:9" small label={false} title="Cómo se hizo" meta="60-90 s · sin sonido" />
                  <div className="how"><p><b>Cómo se hizo.</b> La conversación completa, grabada en la interfaz de Uonify: los archivos que eliges en Drive, las preguntas de Uony, el plan del vídeo con su precio, la vista previa y la aprobación.</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="journey soft" id="redes" aria-labelledby="redes-title">
          <div className="wrap">
            <div className="intro">
              <p className="eyebrow">RECORRIDO 02 · REDES</p>
              <h2 id="redes-title">Contenido para tus redes, <span>con o sin fotos.</span></h2>
              <p className="lead">Dile a Uony qué quieres contar. Si tienes fotos, parte de ellas. Si no, imagina la escena contigo y te enseña el plan antes de crearla.</p>
            </div>
            <div className="social">
              <div className="case">
                <div>
                  <p className="eyebrow">CON TUS FOTOS</p>
                  <h3>Tu producto, tal y como es</h3>
                  <p>Uony parte de tus fotos, de Drive o de tu ordenador, para que se reconozca tu producto en cada escena.</p>
                  <span className="bubble">Haz un vídeo vertical de 16 s con estas fotos que te elijo de mi Drive.</span>
                </div>
                <Slot pin={7} kind="Vídeo" ratio="9:16" title="Basic Mini Bricks · reel" meta="9:16 · 720p · 16 s · Veo 3.1 Fast" />
              </div>
              <div className="case">
                <div>
                  <p className="eyebrow">SIN FOTOS</p>
                  <h3>Desde una idea</h3>
                  <p>Cuéntale la escena con tus palabras. Uony la convierte en un plan, con sus escenas y su precio, y la crea cuando le das el OK.</p>
                  <span className="bubble">No tengo fotos. Hazme un vídeo vertical de una lámpara que ilumina un salón al atardecer.</span>
                </div>
                <Slot pin={8} kind="Vídeo" ratio="9:16" title="Lámpara de mesa · reel" meta="9:16 · 720p · 8 s · Veo 3.1 Fast" />
              </div>
            </div>
            <div className="elements">
              <div>
                <p className="eyebrow">ELEMENTOS</p>
                <h3>Tus Elementos, siempre a mano.</h3>
                <p>Guarda un personaje, un producto, un lugar o un estilo y llámalo por su nombre: «Ana con la lámpara en el salón». Uony lo usa en cada pieza para mantenerlo coherente.</p>
              </div>
              <div className="tiles">
                <div><Slot pin={9} kind="" ratio="1:1" image small mark /><p className="tile-label">Ana<small>personaje</small></p></div>
                <div><Slot pin={10} kind="" ratio="1:1" image small mark /><p className="tile-label">Lámpara de mesa<small>producto</small></p></div>
                <div><Slot pin={11} kind="" ratio="1:1" image small mark /><p className="tile-label">Salón<small>lugar</small></p></div>
                <div><Slot pin={12} kind="" ratio="1:1" image small mark /><p className="tile-label">Luz cálida<small>estilo</small></p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="gallery" aria-labelledby="gallery-title">
          <div className="wrap">
            <p className="eyebrow">PIEZAS QUE PUEDES PEDIR</p>
            <h2 id="gallery-title">Pide lo que imagines. <span>O empieza por un atajo.</span></h2>
            <p className="lead">Uony te sugiere los formatos que más usan los vendedores. Antes de crear cada pieza, te pregunta el formato y te enseña su precio máximo.</p>
            <div className="bento">
              <div className="col">
                <div className="piece"><Slot pin={2} kind="Vídeo" ratio="16:9" meta="16:9 · 720p · 24 s" /><div className="txt"><h3>Vídeo de producto</h3><p>Para la ficha o para tus redes.</p><span className="ask">«Haz un vídeo de 24 s que enseñe cómo se monta.»</span></div></div>
                <div className="piece"><Slot pin={15} kind="Vídeo" ratio="9:16" meta="9:16 · 720p · 8-16 s · Veo 3.1 Fast" /><div className="txt"><h3>Anuncio UGC</h3><p>Alguien lo enseña en casa, en primera persona.</p><span className="ask">«Haz un anuncio UGC: alguien abre la caja y la monta.»</span></div></div>
              </div>
              <div className="col">
                <div className="piece"><Slot pin={3} kind="Imagen" ratio="1:1" image small meta="1:1 · 1K · Nano Banana" /><div className="txt"><h3>Imagen principal</h3><p>Fondo blanco, lista para la ficha.</p><span className="ask">«Hazme la imagen principal con fondo blanco.»</span></div></div>
                <div className="piece"><Slot pin={13} kind="Imagen" ratio="2:1" image meta="A+ · 1K · Nano Banana" /><div className="txt"><h3>Banner A+</h3><p>La cabecera de tu contenido A+.</p><span className="ask">«Crea el banner A+ con la torre montada.»</span></div></div>
                <div className="piece"><Slot pin={4} kind="Imagen" ratio="1:1" image small meta="1:1 · 1K · Nano Banana" /><div className="txt"><h3>Ambiente</h3><p>Tu producto, en su sitio.</p><span className="ask">«Ponlo en un salón luminoso, por la tarde.»</span></div></div>
              </div>
              <div className="col">
                <div className="piece"><Slot pin={14} kind="Vídeo" ratio="9:16" meta="9:16 · 720p · 15 s · Veo 3.1 Fast" /><div className="txt"><h3>Anuncio de 15 s</h3><p>Directo al grano.</p><span className="ask">«Hazme un anuncio vertical de 15 s.»</span></div></div>
                <div className="piece"><Slot pin={5} kind="Imagen" ratio="1:1" image small meta="1:1 · 1K · Nano Banana" /><div className="txt"><h3>Infografía</h3><p>Lo importante, de un vistazo.</p><span className="ask">«Hazme una infografía con las medidas y lo que trae la caja.»</span></div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="trust" aria-labelledby="trust-title">
          <div className="wrap">
            <p className="eyebrow">CON TU VISTO BUENO</p>
            <h2 id="trust-title">Uony propone. <span>Tú decides.</span></h2>
            <div className="cols">
              <figure className="shot" style={{ margin: 0 }}>
                <div className="card" aria-label="Tarjeta del chat con el plan de una pieza">
                  <div className="over">PARA CREAR</div>
                  <h4>Vídeo para la ficha · Basic Mini Bricks</h4>
                  <div className="spec">Vídeo rápido · <span className="mono">3 escenas · 24 s · 16:9 · 720p</span> · Veo 3.1 Fast</div>
                  <div style={{ marginTop: 12 }}>
                    <div className="scene"><span className="mono">1</span><div><b>La caja</b><small>La caja se abre sobre la mesa</small></div><span className="chip"><I id="box" w={14} h={14} />Basic Mini Bricks</span></div>
                    <div className="scene"><span className="mono">2</span><div><b>El montaje</b><small>Unas manos apilan las piezas</small></div><span className="chip"><I id="palette" w={14} h={14} />Luz cálida</span></div>
                    <div className="scene"><span className="mono">3</span><div><b>La torre</b><small>La torre terminada, en el salón</small></div><span className="chip"><I id="pin" w={14} h={14} />Salón</span></div>
                  </div>
                  <div className="price"><b>Como máximo ≈ 3,60 €</b><span>· lo paga tu proyecto de Google</span></div>
                  <div className="acts"><span className="fake blue">Crear</span><span className="fake">Cambiar</span><small>o contesta «sí»</small></div>
                </div>
                <figcaption className="card-cap">Así te lo enseña Uony en el chat, antes de crear nada. El precio es un ejemplo; en cada pieza ves el suyo.</figcaption>
              </figure>
              <div className="points">
                <div><span className="ico"><I id="euro" w={20} h={20} /></span><h3>Precio antes de crear</h3><p>Ves el precio máximo en euros y quién lo paga: tu proyecto de Google. El importe exacto aparece en tu factura de Google.</p></div>
                <div><span className="ico"><I id="check" w={20} h={20} /></span><h3>Un OK por cada gasto</h3><p>Nada se crea sin tu visto bueno, y cada cambio vuelve a pedirlo. Un lote de piezas se aprueba de una vez, con su máximo total.</p></div>
                <div><span className="ico"><I id="refresh" w={20} h={20} /></span><h3>Si algo falla, te lo explica</h3><p>Uony te cuenta qué ha pasado en palabras sencillas y te propone una versión ajustada, que vuelve a pedir tu OK.</p></div>
                <div><span className="ico"><I id="library" w={20} h={20} /></span><h3>Todo queda en tu biblioteca</h3><p>Descarga tus piezas cuando quieras, o pide a Uony que las lleve a tu ficha, siempre con tu aprobación.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="cd-close wrap" aria-labelledby="cd-close-title">
          <div className="chars"><img src="/assets/product-icons/catalogo.png" width="84" height="84" alt="" loading="lazy" /><img src="/assets/product-icons/hive.png" width="84" height="84" alt="" loading="lazy" /><img src="/assets/product-icons/nexus.png" width="84" height="84" alt="" loading="lazy" /></div>
          <h2 id="cd-close-title">Empieza con una conversación. <span>Lo demás, paso a paso.</span></h2>
          <p className="lead">Entra en Uonify desde 9,90 € al mes + IVA (en España, 11,98 € al mes con el IVA incluido; el IVA final depende de tu país) y empieza a trabajar con Uony. Tienes 14 días para darte de baja. Las imágenes y los vídeos los paga tu proyecto de Google, a sus precios, y ves su precio antes de crear cada pieza.</p>
          <p className="note">¿Nuevo en Google Cloud? Google ofrece a sus clientes nuevos 300 $ de crédito de prueba durante 90 días, según sus condiciones.</p>
          <div className="actions">
            <HomeLink className="button primary" to={PATHS.composer}>Empieza con Uony <I id="arrow-right" /></HomeLink>
            <HomeLink className="text-link" to={PATHS.precios}>Ver precios <I id="arrow-right" /></HomeLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </PublicView>
  );
}
