import { useState } from 'react';
import clsx from 'clsx';
import { Icon, registerIcon } from '@/shared/ui';
import { drivePreviewUrl, driveFileViewUrl, type EstudioCard, type EstudioItem, type EstudioScene, type EstudioTag, type EstudioSceneState } from '../model/estudioCard';
import { sendPrompt } from '../hooks/conversation';
import { focusComposer } from '../hooks/actions';
import { EstudioViewer } from './EstudioViewer';
import '../styles/conversation-estudio-cards.css';

// El pin de ubicación no está en el set de serie; se registra una vez al cargar.
registerIcon('map-pin', '<path d="M20 10c0 4.4-8 12-8 12s-8-7.6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>');

const TAG_ICON: Record<EstudioTag['type'], string | null> = { persona: null, producto: 'package', lugar: 'map-pin', estilo: 'palette' };
// `entregando`/`entregaPendiente` (F10): el vídeo ya se generó (y se cobró), queda la entrega al Drive. Rótulos
// HONESTOS: NUNCA «sin coste» (ese solo en `fallida`, fallo sin gasto). Literales aprobados por el dueño (29-10-2026).
const STATE_LABEL: Record<EstudioSceneState, string> = { enCola: 'En cola', creandose: 'Creando', lista: 'Lista', fallida: 'No creada · sin coste', incierta: 'Sin confirmar · sin coste', entregando: 'Guardándose en tu Drive', entregaPendiente: 'Guardado pendiente' };

// Motor de Google SIEMPRE genérico al cliente (D-PROTECCION-INGENIERIA-INVERSA,
// decisión del dueño 23-10): nunca el modelo/versión exactos en pantalla. Defensa
// en profundidad: aunque el backend mande engineLabel con el nombre real, aquí se
// muestra el genérico según el medio de la tarjeta.
function engineLabel(card: EstudioCard): string {
  return card.kind === 'images' ? 'Imagen con IA de Google' : 'Vídeo con IA de Google';
}

// El precio llega como decimal con punto («0.36», máquina) o ya con coma; se muestra con coma decimal (ES).
function formatEur(value: string): string {
  return value.replace('.', ',');
}

/** Línea de metadatos «Vídeo rápido · 3 escenas · 24 s · 16:9 · 720p · Vídeo con IA de Google». */
function metaLine(card: EstudioCard): string {
  const m = card.meta ?? card.imageMeta;
  if (!m) return '';
  const parts: string[] = [];
  if (m.format) parts.push(m.format);
  if (m.scenes) parts.push(`${m.scenes} ${m.scenes === 1 ? 'escena' : 'escenas'}`);
  if (m.durationSec) parts.push(`${m.durationSec} s`);
  if (m.aspect) parts.push(m.aspect);
  if (m.resolution) parts.push(m.resolution);
  parts.push(engineLabel(card));
  return parts.join(' · ');
}

function Tag({ tag }: { tag: EstudioTag }) {
  const icon = TAG_ICON[tag.type];
  return (
    <span className="estudio-tag">
      {icon ? <Icon name={icon} size={13} /> : <span className="estudio-tag-initial" aria-hidden="true">{tag.label.slice(0, 1).toUpperCase()}</span>}
      {tag.label}
    </span>
  );
}

function SceneRow({ scene }: { scene: EstudioScene }) {
  return (
    <div className="estudio-scene">
      <span className="estudio-scene-index">{scene.index}</span>
      <div className="estudio-scene-main">
        <strong>{scene.title}</strong>
        {scene.subtitle ? <span>{scene.subtitle}</span> : null}
      </div>
      {scene.tags?.length ? <div className="estudio-scene-tags">{scene.tags.map((tag, i) => <Tag key={i} tag={tag} />)}</div> : null}
    </div>
  );
}

function StateMark({ state }: { state: EstudioSceneState }) {
  if (state === 'lista') return <span className="estudio-state is-ok"><Icon name="check-circle" size={15} />{STATE_LABEL.lista}</span>;
  if (state === 'creandose') return <span className="estudio-state is-work"><Icon name="loader" size={15} className="estudio-spin" />{STATE_LABEL.creandose}</span>;
  // Entrega al Drive en curso: trabajo (girando), tono neutro; el vídeo ya existe, se está guardando.
  if (state === 'entregando') return <span className="estudio-state is-work"><Icon name="loader" size={15} className="estudio-spin" />{STATE_LABEL.entregando}</span>;
  // Fallo/incierto/entrega-pendiente: tono neutro y tranquilizador, no alarma roja. «sin coste» solo en `fallida`.
  if (state === 'fallida') return <span className="estudio-state">{STATE_LABEL.fallida}</span>;
  if (state === 'incierta') return <span className="estudio-state">{STATE_LABEL.incierta}</span>;
  if (state === 'entregaPendiente') return <span className="estudio-state">{STATE_LABEL.entregaPendiente}</span>;
  return <span className="estudio-state">{STATE_LABEL.enCola}</span>;
}

function ItemThumb({ item }: { item: EstudioItem }) {
  if (item.state === 'lista') return <span className="estudio-thumb is-ready"><Icon name="play" size={18} /></span>;
  if (item.state === 'creandose' || item.state === 'entregando') return <span className="estudio-thumb"><Icon name="loader" size={16} className="estudio-spin" /></span>;
  if (item.state === 'fallida' || item.state === 'incierta') return <span className="estudio-thumb"><Icon name="x" size={16} /></span>;
  // entregaPendiente y en cola: reloj neutro (sin «x» de fallo: el vídeo existe / está por empezar).
  return <span className="estudio-thumb"><Icon name="clock" size={16} /></span>;
}

/** Acciones inyectables de la tarjeta. Si no se pasan, los botones usan la vía conversacional de siempre
 *  (sin cambio visual ni de comportamiento). El cableado del clip simple (motor 090) inyecta `onCreate` para
 *  que «Crear/Generar» llame a las rutas HTTP (authorize→confirmations) en vez de a la conversación. */
export interface EstudioCardHandlers {
  onCreate?: () => void;
  onChange?: () => void;
  onPublish?: () => void;
}

/** Tarjeta del Estudio en el chat. Los datos vienen del backend (card-safe); las
 *  acciones usan la conversación (sendPrompt) o abren el visor; nada se simula. */
export function ConversationEstudioCard({ card, active, handlers }: { card: EstudioCard; active: boolean; handlers?: EstudioCardHandlers }) {
  const [viewer, setViewer] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canCreate = active && typeof card.maxEur === 'string';
  const openViewer = () => setViewer(true);
  const onCreate = handlers?.onCreate ?? (() => sendPrompt('Sí, crea la pieza.'));
  const onChange = handlers?.onChange ?? focusComposer;
  const onPublish = handlers?.onPublish;

  if (card.kind === 'plan') {
    return (
      <section className="estudio-card" aria-label={`Plan del Estudio: ${card.title}`}>
        <p className="estudio-eyebrow">Para crear</p>
        <h3 className="estudio-title">{card.title}</h3>
        {card.meta ? <p className="estudio-meta">{metaLine(card)}</p> : null}
        <div className="estudio-scenes">{card.scenes?.map(scene => <SceneRow key={scene.index} scene={scene} />)}</div>
        <p className="estudio-cost">
          {typeof card.maxEur === 'string'
            ? <><strong>Como máximo ≈ {formatEur(card.maxEur)} €</strong> · lo paga tu proyecto de Google</>
            : <span className="estudio-cost-pending">Te digo el precio exacto antes de empezar.</span>}
        </p>
        {active ? (
          <div className="estudio-actions">
            <button type="button" className="estudio-primary" disabled={!canCreate} onClick={onCreate}>Crear</button>
            <button type="button" className="estudio-secondary" onClick={onChange}>Cambiar</button>
            <span className="estudio-hint">o contesta «sí»</span>
          </div>
        ) : null}
      </section>
    );
  }

  if (card.kind === 'creating') {
    const pct = card.progress && card.progress.total > 0 ? Math.round((card.progress.current / card.progress.total) * 100) : 0;
    return (
      <section className="estudio-card" aria-label={`Creando: ${card.title}`} aria-live="polite">
        <p className="estudio-creating-head"><Icon name="loader" size={16} className="estudio-spin" />
          Creando tu vídeo{card.progress ? ` · escena ${card.progress.current} de ${card.progress.total}` : ''}</p>
        <div className="estudio-items">
          {card.items?.map(item => (
            <div key={item.index} className="estudio-item">
              <ItemThumb item={item} />
              <div className="estudio-item-main"><strong>{item.index} · {item.title}</strong>{item.subtitle ? <span>{item.subtitle}</span> : null}</div>
              <StateMark state={item.state} />
            </div>
          ))}
        </div>
        <div className="estudio-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
        <p className="estudio-foot">Unos minutos. Puedes seguir trabajando; te aviso al terminar.</p>
      </section>
    );
  }

  if (card.kind === 'images') {
    return (
      <section className="estudio-card" aria-label={card.title}>
        <p className="estudio-eyebrow">{card.title}</p>
        <div className="estudio-images">
          {card.images?.map(image => (
            <div key={image.id} className={clsx('estudio-image', image.selected && 'is-selected')}>
              <div className="estudio-image-frame">{image.previewUrl ? <img src={image.previewUrl} alt={image.label} /> : <Icon name="image" size={30} />}</div>
              <div className="estudio-image-foot">
                <strong>{image.label}</strong>
                {active ? <button type="button" className="estudio-link" onClick={openViewer}><Icon name="maximize-2" size={13} /> Ver en grande</button> : null}
              </div>
            </div>
          ))}
        </div>
        {card.imageMeta ? <p className="estudio-meta">{metaLine(card)}</p> : null}
        {viewer ? <EstudioViewer card={card} onClose={() => setViewer(false)} /> : null}
      </section>
    );
  }

  if (card.kind === 'publish') {
    return (
      <section className="estudio-card estudio-publish" aria-label={`Para publicar: ${card.title}`}>
        <p className="estudio-eyebrow">Para publicar</p>
        <div className="estudio-publish-row">
          <span className="estudio-publish-icon" aria-hidden="true"><Icon name="image" size={20} /></span>
          <div className="estudio-publish-main"><strong>{card.title}</strong>{card.publishTarget ? <span>{card.publishTarget.detail}</span> : null}</div>
        </div>
        {active ? (
          <div className="estudio-actions">
            <button type="button" className="estudio-primary" onClick={onPublish ?? (() => sendPrompt('Sí, publícala.'))}>Publicar</button>
            <button type="button" className="estudio-secondary" onClick={onChange}>Cancelar</button>
            <span className="estudio-hint">o contesta «sí»</span>
          </div>
        ) : null}
      </section>
    );
  }

  // result
  const first = card.items?.[0];
  // El vídeo se reproduce INLINE en la propia tarjeta (principio: minimizar lo que saca al cliente de la conversación).
  // Solo hay reproductor cuando la entrega al Drive confirmó un fileId (cierre honesto); si no, no se llega a esta tarjeta.
  const canPlay = typeof card.previewFileId === 'string' && card.previewFileId.length > 0;
  const playInline = () => { if (canPlay) setPlaying(true); };
  // Descargar: si el backend manda un downloadUrl real (signed URL de GCS), descarga directa 1-clic. Mientras no,
  // APAÑO: abrir la VISTA del archivo en Drive (no el enlace `uc?export=download`, que fuerza authuser=0 y da 403 si
  // el clip vive en el Drive de otra cuenta). Desde la vista de Drive el cliente descarga con su cuenta correcta.
  const downloadHref = card.downloadUrl ?? (canPlay ? driveFileViewUrl(card.previewFileId as string) : undefined);
  return (
    <section className="estudio-card" aria-label={`Resultado: ${card.title}`}>
      <div className="estudio-player">
        {playing && canPlay && !viewer ? (
          // Reproducción INLINE: el MISMO embed nativo de Drive del visor, dentro de la tarjeta. No abre modal.
          // Al abrir el visor ampliado (`viewer`) se desmonta este iframe: nunca dos reproductores de Drive a la vez
          // (el dueño confundía el reproductor del modal + este de fondo con «dos vídeos / dos cobros»).
          <iframe className="estudio-viewer-drive" src={drivePreviewUrl(card.previewFileId as string)} title={card.title} allow="autoplay" />
        ) : (
          <button type="button" className="estudio-player-trigger" onClick={playInline} disabled={!canPlay} aria-label="Reproducir el vídeo aquí">
            {first?.posterUrl ? <img src={first.posterUrl} alt="" /> : null}
            <span className="estudio-player-play"><Icon name="play" size={22} /></span>
            <span className="estudio-player-title">{card.title}</span>
          </button>
        )}
        {/* Expandir: ÚNICA acción que abre el visor ampliado (modal). Separado del play (play NUNCA abre modal). */}
        <button type="button" className="estudio-player-expand" onClick={openViewer} aria-label="Ver en grande (vista ampliada)"><Icon name="maximize-2" size={16} /></button>
      </div>
      {/* Tira de escenas SOLO con varias escenas (sirve para elegir entre ellas). Con un único clip la tira sería un
          recuadro redundante bajo el reproductor que el dueño lee como «un segundo vídeo»: en ese caso no se muestra.
          La miniatura es SIEMPRE una imagen/ícono ligero, nunca un reproductor completo de Drive. */}
      {(card.items?.length ?? 0) > 1 ? (
        <div className="estudio-strip">
          {card.items?.map(item => (
            <button key={item.index} type="button" className="estudio-strip-item" onClick={playInline}>
              <span className="estudio-thumb is-ready">{item.posterUrl ? <img src={item.posterUrl} alt="" /> : <Icon name="play" size={16} />}</span>
              <span className="estudio-strip-label">{item.index} · {item.title}{item.durationSec ? ` · ${item.durationSec} s` : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      {card.meta ? <p className="estudio-meta">{card.version ? `Versión ${card.version} · ` : ''}{metaLine(card)}</p> : null}
      {active ? (
        <div className="estudio-actions">
          <button type="button" className="estudio-primary" onClick={onPublish ?? (() => sendPrompt('Sí, publícalo.'))}>Publicar</button>
          <button type="button" className="estudio-secondary" disabled={!downloadHref} onClick={() => { if (downloadHref) window.open(downloadHref, '_blank', 'noopener'); }}><Icon name="download" size={14} /> Descargar</button>
          <button type="button" className="estudio-secondary" onClick={onChange}><Icon name="refresh-cw" size={14} /> Cambiar una escena</button>
          {/* «Abrir en Estudio» RETIRADO (29-10, decisión del dueño): el Estudio vive en el chat (no hay vista de módulo
              ni deep-link de la pieza), así que no tiene destino; y el modal ampliado debe abrirse SOLO con el botón ⤢.
              Reactivar como navegación al módulo Estudio cuando exista una vista de la pieza. */}
        </div>
      ) : null}
      {viewer ? <EstudioViewer card={card} onClose={() => setViewer(false)} /> : null}
    </section>
  );
}
