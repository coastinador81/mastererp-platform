import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useMutation } from '@tanstack/react-query';
import { Button, Icon } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { ESTUDIO_UPLOAD_ACCEPT, ESTUDIO_UPLOAD_MAX_MB, estudioUploadErrorCode, uploadEstudioImage, type EstudioUploadAsset } from '../api/estudioUploads';
import '../styles/conversation-estudio-cards.css';
import '../styles/estudio-upload.css';

// Texto canónico de Legal — fuente única: docs/legal/TEXTOS-ALTA-Y-AVISOS.md §16 «¿Dónde vive tu contenido?».
const OWNERSHIP = 'Tu foto se guarda en tu propio Google (tu almacenamiento en Google Cloud), no en Uonify. Uonify solo guarda una referencia para animarla; tú mantienes el control.';

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export interface EstudioImageUploadProps {
  threadId: string;
  /** Se llama con el assetId opaco cuando la foto está lista, para arrancar el paso de generar. */
  onReady: (asset: EstudioUploadAsset) => void;
}

/**
 * Subida REAL de la foto del producto al Estudio. Implementa la experiencia YA aprobada de la maqueta subir-foto
 * (identidad del Estudio): arrastrar/elegir → subir → «Animar con Uony». Sube por multipart con `uploadEstudioImage`
 * (contrato estable de SC) y entrega el `assetId` opaco por `onReady`. INERTE: no está montada en el flujo real;
 * se conecta cuando SC monte el endpoint + con OK del dueño + Consultor/REA. La foto no sale del navegador hasta
 * que el cliente elige subirla; la previsualización es local (`URL.createObjectURL`).
 */
export function EstudioImageUpload({ threadId, onReady }: EstudioImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; sizeLabel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (chosen: File) => uploadEstudioImage(threadId, chosen),
    onError: reason => setError(estudioUploadErrorCode(reason) === 'cloud_not_ready'
      ? 'Para subir tu foto, conecta antes tu Google Cloud.'
      : errorMessage(reason, 'No se ha podido subir la foto. Inténtalo de nuevo.')),
  });

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setError(null);
    upload.reset();
  };

  const choose = (chosen: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!chosen) return;
    setError(null);
    if (!/^image\/(jpeg|png)$/.test(chosen.type)) { setError('Ese archivo no es una foto. Sube un JPG o PNG.'); return; }
    if (chosen.size > ESTUDIO_UPLOAD_MAX_MB * 1024 * 1024) { setError(`La foto pesa demasiado. El máximo es ${ESTUDIO_UPLOAD_MAX_MB} MB.`); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(chosen));
    setFile({ name: chosen.name, sizeLabel: megabytes(chosen.size) });
    upload.mutate(chosen);
  };

  const asset = upload.data;
  const uploading = upload.isPending;
  const ready = !!asset && !uploading;

  return (
    <section className="estudio-card esu-card" aria-label="Sube una foto de tu producto">
      <p className="estudio-eyebrow">Para empezar</p>
      <h3 className="estudio-title">Sube una foto de tu producto</h3>
      <p className="estudio-meta">La animo y creo un vídeo para tu ficha. Tú la eliges; no se crea nada sin tu confirmación.</p>

      {!preview ? (
        <>
          <div
            className={clsx('esu-drop', over && 'is-over')}
            onDragOver={event => { event.preventDefault(); setOver(true); }}
            onDragLeave={event => { event.preventDefault(); setOver(false); }}
            onDrop={event => { event.preventDefault(); setOver(false); choose(event.dataTransfer?.files?.[0]); }}
          >
            <span className="esu-drop-mark" aria-hidden="true"><Icon name="upload" size={22} /></span>
            <p className="esu-drop-title">Arrastra tu foto aquí</p>
            <p className="esu-drop-sub">o selecciónala de tu equipo</p>
            <button type="button" className="estudio-secondary" onClick={() => inputRef.current?.click()}>
              <Icon name="image" size={14} /> Elegir foto
            </button>
            <input ref={inputRef} type="file" accept={ESTUDIO_UPLOAD_ACCEPT} hidden tabIndex={-1} aria-hidden="true"
              onChange={event => choose(event.target.files?.[0])} />
          </div>
          {error ? <p className="esu-error" role="alert"><Icon name="x" size={14} /> {error}</p> : null}
          <p className="esu-req">JPG o PNG · hasta {ESTUDIO_UPLOAD_MAX_MB} MB</p>
        </>
      ) : (
        <>
          <div className="esu-preview">
            <span className="esu-frame">{preview ? <img src={preview} alt="Tu foto" /> : <Icon name="image" size={30} />}</span>
            <div className="esu-file">
              <strong>{file?.name}</strong>
              <span>{file?.sizeLabel}</span>
              {uploading ? <span className="esu-badge is-work"><Icon name="loader" size={13} className="estudio-spin" /> Subiendo tu foto…</span>
                : ready ? <span className="esu-badge is-ok"><Icon name="check-circle" size={13} /> Foto lista</span>
                : null}
            </div>
          </div>
          {error ? <p className="esu-error" role="alert"><Icon name="x" size={14} /> {error}</p> : null}
          <p className="esu-ownership"><Icon name="shield" size={14} /> {OWNERSHIP}</p>
          <div className="estudio-actions">
            <Button variant="primary" icon="uony" loading={uploading} disabled={!ready} onClick={() => { if (asset) onReady(asset); }}>
              Animar con Uony
            </Button>
            <button type="button" className="estudio-secondary" onClick={reset}><Icon name="refresh-cw" size={14} /> Cambiar foto</button>
          </div>
        </>
      )}
    </section>
  );
}
