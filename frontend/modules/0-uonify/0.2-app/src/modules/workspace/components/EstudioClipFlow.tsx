import { Icon, registerIcon } from '@/shared/ui';
import type { EstudioUploadAsset } from '../api/estudioUploads';
import type { ClipLatest, EstudioClipClient } from '../api/estudioClip';
import { sendPrompt } from '../hooks/conversation';
import { useEstudioClip, type ClipParams } from '../hooks/estudioClip';
import { ConversationEstudioCard } from './ConversationEstudioCard';
import '../styles/conversation-estudio-cards.css';

// Icono de nube para la tarjeta de reconexión (no está en el set de serie; se registra una vez al cargar).
registerIcon('cloud', '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 6 18.7"/><path d="M6 19h11.5"/>');

/**
 * Cableado del CLIP SIMPLE (motor 090, contrato v1 de SC) sobre las tarjetas REALES del Estudio. Dada una foto ya
 * subida (owned-input), cotiza y muestra la tarjeta «PARA CREAR»; durante la cotización, «sin precio» con Crear
 * deshabilitado; el botón «Crear» encadena authorize→confirmations y arranca el polling; «Creando…» por escena con
 * los estados defensivos de la maqueta; al terminar, el resultado con preview nativo en el Drive del cliente.
 *
 * Presentacional + orquestación; el cliente HTTP es INYECTABLE (la app usa el real detrás del flag
 * `estudioClipWiringEnabled`; la maqueta/pruebas inyectan un stub del contrato). No se monta aún en la conversación
 * viva (eso es el cableado real con OK del dueño + deploy). Fiel a `platform/artifacts/maqueta-video-validada-20261028/`.
 */
export interface EstudioClipFlowProps {
  threadId: string;
  /** La foto ya subida (de `EstudioImageUpload`) para un clip NUEVO. Opcional si se rehidrata con `resume`. */
  asset?: EstudioUploadAsset;
  /** F11c: job existente del hilo (de `jobs/latest`) para REHIDRATAR su tarjeta sin re-subir la foto. */
  resume?: ClipLatest | null;
  params?: ClipParams;
  /** Cliente HTTP inyectable; por defecto el real del contrato v1. */
  client?: EstudioClipClient;
  /** «Cambiar»/«Empezar otro»: volver al paso de elegir foto (lo gestiona el contenedor). */
  onChangePhoto?: () => void;
  /** «Conectar Google Cloud»: abre el flujo de conexión (lo gestiona el contenedor). Si no se pasa, se pide
   *  por la conversación (tarjeta de conexión inline, sin sacar al cliente del chat). */
  onReconnect?: () => void;
}

export function EstudioClipFlow({ threadId, asset, resume, params, client, onChangePhoto, onReconnect }: EstudioClipFlowProps) {
  const { card, error, errorCode, phase, create, requote, recheck } = useEstudioClip({ threadId, asset: asset ?? null, resume, params, client });

  // Estado de borde: el Estudio no puede cotizar porque el Google Cloud del cliente no está conectado / vigente
  // (409 `cloud_not_ready`). En vez del error genérico, se invita a reconectar y reintentar «Animar». No se cobra
  // ni se crea nada. El rótulo exacto del código lo fija SC/Consultor al cablear; aquí distinguimos el camino.
  if (errorCode === 'cloud_not_ready') {
    const reconnect = onReconnect ?? (() => sendPrompt('Conecta mi Google Cloud para animar mi foto.'));
    return (
      <section className="estudio-card" aria-label="Conecta tu Google Cloud para animar la foto" role="status">
        <p className="estudio-eyebrow">Conecta tu Google</p>
        <h3 className="estudio-title">Conecta tu Google Cloud para animar tu foto</h3>
        <p className="estudio-meta">Para crear el vídeo necesito tu Google Cloud conectado. Conéctalo y lo intento otra vez. No se crea ni se cobra nada.</p>
        <div className="estudio-actions">
          <button type="button" className="estudio-primary" onClick={reconnect}><Icon name="cloud" size={15} /> Conectar Google Cloud</button>
          <button type="button" className="estudio-secondary" onClick={requote}><Icon name="refresh-cw" size={14} /> Reintentar «Animar»</button>
          {onChangePhoto ? <button type="button" className="estudio-secondary" onClick={onChangePhoto}><Icon name="image" size={14} /> Cambiar foto</button> : null}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="estudio-card" aria-label="No se pudo generar el clip" role="alert">
        <p className="estudio-eyebrow">Para crear</p>
        <p className="estudio-cost"><Icon name="x" size={15} /> {error}</p>
        <div className="estudio-actions">
          <button type="button" className="estudio-primary" onClick={requote}>Reintentar</button>
          {onChangePhoto ? <button type="button" className="estudio-secondary" onClick={onChangePhoto}><Icon name="refresh-cw" size={14} /> Cambiar foto</button> : null}
        </div>
      </section>
    );
  }

  // Entrega al Drive del vídeo YA creado y COBRADO. Dos fases honestas, mismos literales (solo cambia el eyebrow):
  //  - `delivering`: adoptado al almacén, la entrega perezosa al Drive aún no confirma el fileId → «Guardándose en tu
  //    Drive». Evita mostrar «Lista» sin poder reproducir (garantía al dueño).
  //  - `deliveryFailed`: la entrega falló y se está recuperando → «Guardado pendiente».
  // «Comprobar de nuevo» re-intenta sin crear ni cobrar. NUNCA «sin coste». Literales aprobados por el dueño (29-10-2026).
  if (phase === 'delivering') {
    return <DeliveryPendingCard eyebrow="Guardándose en tu Drive" onRecheck={recheck} onChangePhoto={onChangePhoto} />;
  }
  if (phase === 'deliveryFailed') {
    return <DeliveryPendingCard eyebrow="Guardado pendiente" onRecheck={recheck} onChangePhoto={onChangePhoto} />;
  }

  if (!card) return null;

  return <ConversationEstudioCard card={card} active handlers={{ onCreate: create, onChange: onChangePhoto }} />;
}

/** Tarjeta HONESTA de entrega al Drive de un vídeo YA creado y COBRADO. `eyebrow` distingue la fase: «Guardándose en
 *  tu Drive» (entrega perezosa en curso) o «Guardado pendiente» (entrega fallida, reintentable). Título/cuerpo/botones
 *  son los literales aprobados por el dueño (29-10-2026). NUNCA dice «sin coste». «Comprobar de nuevo» no crea ni cobra. */
function DeliveryPendingCard({ eyebrow, onRecheck, onChangePhoto }: { eyebrow: string; onRecheck: () => void; onChangePhoto?: () => void }) {
  return (
    <section className="estudio-card" aria-label="Tu vídeo se creó; se está guardando en tu Drive" role="status">
      <p className="estudio-eyebrow">{eyebrow}</p>
      <h3 className="estudio-title">Tu vídeo se creó</h3>
      <p className="estudio-meta">Tu vídeo está hecho. Estamos terminando de guardarlo en tu Drive; no tienes que hacer nada. Vuelve a comprobarlo en un momento.</p>
      <div className="estudio-actions">
        <button type="button" className="estudio-primary" onClick={onRecheck}><Icon name="refresh-cw" size={14} /> Comprobar de nuevo</button>
        {onChangePhoto ? <button type="button" className="estudio-secondary" onClick={onChangePhoto}><Icon name="image" size={14} /> Empezar otro</button> : null}
      </div>
    </section>
  );
}
