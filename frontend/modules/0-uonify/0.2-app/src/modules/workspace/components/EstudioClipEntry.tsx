import { useState } from 'react';
import type { EstudioUploadAsset } from '../api/estudioUploads';
import type { EstudioClipClient } from '../api/estudioClip';
import { estudioClipThreadId } from '../api/estudioClip';
import { useEstudioLatest } from '../hooks/estudioClip';
import { EstudioImageUpload } from './EstudioImageUpload';
import { EstudioClipFlow } from './EstudioClipFlow';
import '../styles/conversation-estudio-cards.css';

/**
 * ANDAMIO del clip simple (Opción A, 28-10): la ENTRADA del Estudio en el chat, detrás del flag
 * `estudioClipWiringEnabled` (apagado por defecto). Usa el cliente HTTP REAL por defecto, contra `/api` (combined6).
 *
 * F11c (29-10): al montar el hilo consulta `jobs/latest` (SIN depender del asset en memoria). Si hay un job, REHIDRATA
 * su tarjeta (en curso → reanuda «Creando…»; listo → preview en tu Drive; entrega pendiente → tarjeta honesta); así
 * la tarjeta sobrevive a una recarga y no se pierde. Si no hay job (404), flujo de subida normal: primero la foto
 * (maqueta subir-foto ya aprobada); con la foto lista, cotiza y muestra «PARA CREAR» (con el backend inerte sale
 * «sin precio» → «Crear» deshabilitado → 0 gasto).
 *
 * El montaje conversacional de producción (el backend emite la tarjeta en el turno + intercepción de «sí») es costura
 * posterior de interfaz.
 */
export function EstudioClipEntry({ threadId, client }: { threadId: string; client?: EstudioClipClient }) {
  const [asset, setAsset] = useState<EstudioUploadAsset | null>(null);
  // CONTRATO B (hilo dedicado, decisión del dueño): la SUBIDA es agnóstica al hilo (owned-input por sha256) y se queda
  // en el hilo del chat; el CLIP (quote/authorize/confirm/status/latest) opera en el hilo DEDICADO
  // `estudio-clip:<chatThreadId>`, que componemos aquí. Sin cambio visible.
  const clipThreadId = estudioClipThreadId(threadId);
  const { checking, job, clear } = useEstudioLatest(clipThreadId, client);

  // Mientras se comprueba si el hilo ya tiene un job, no decidimos subida vs rehidratar (evita el parpadeo de la subida).
  if (checking) {
    return (
      <section className="estudio-card" role="status" aria-label="Recuperando tu Estudio">
        <p className="estudio-meta">Recuperando tu Estudio…</p>
      </section>
    );
  }

  // Hay un job en el hilo (y no estás empezando otro): rehidrata su tarjeta sin re-subir la foto.
  if (job && !asset) {
    return <EstudioClipFlow threadId={clipThreadId} resume={job} client={client} onChangePhoto={() => { clear(); setAsset(null); }} />;
  }

  if (!asset) return <EstudioImageUpload threadId={threadId} onReady={setAsset} />;
  return <EstudioClipFlow threadId={clipThreadId} asset={asset} client={client} onChangePhoto={() => setAsset(null)} />;
}
