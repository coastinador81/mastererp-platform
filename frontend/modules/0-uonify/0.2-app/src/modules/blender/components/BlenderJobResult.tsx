import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/shared/api/client';
import { useEffect, useRef } from 'react';
import { blenderJobPending, blenderPreviewPath, type BlenderJob } from '../model/types';

function PrivatePreview({ path, account }: { path: string; account: string }) {
  const image = useRef<HTMLImageElement>(null);
  const preview = useQuery({ queryKey: ['blender-preview', account, path], queryFn: () => api.get<Blob>(path, { responseType: 'blob' }), retry: false, gcTime: 0 });
  useEffect(() => {
    if (!preview.data) return;
    const imageUrl = URL.createObjectURL(preview.data);
    if (image.current) image.current.src = imageUrl;
    return () => URL.revokeObjectURL(imageUrl);
  }, [preview.data]);
  if (preview.isError) return <p role="alert">No hemos podido cargar la vista previa. <button className="pim-btn pim-btn-outline" onClick={() => void preview.refetch()}>Reintentar imagen</button></p>;
  return <figure className="bln-preview">{preview.data ? <img ref={image} alt="Vista previa de la escena de Blender" /> : <p role="status">Cargando vista previa…</p>}<figcaption>Vista previa de tu Blender local · hasta 320 px</figcaption></figure>;
}

export function BlenderPreview({ job, account }: { job: BlenderJob; account: string }) {
  const path = blenderPreviewPath(job.previewUrl);
  return path ? <PrivatePreview key={`${account}:${path}`} path={path} account={account} /> : <p role="alert">La vista previa no está disponible.</p>;
}

export function BlenderJobResult({ job, account, showPreview = true }: { job: BlenderJob; account: string; showPreview?: boolean }) {
  const path = blenderPreviewPath(job.previewUrl);
  const scene = job.result?.scene;
  return <div className="bln-result" aria-live="polite">
    {blenderJobPending(job) && <p role="status">{job.status === 'queued' ? 'Esperando a Blender…' : job.operation === 'render_preview' ? 'Preparando la vista previa en tu ordenador…' : 'Consultando la escena en Blender…'}</p>}
    {job.status === 'failed' && <p role="alert">{typeof job.error === 'string' ? job.error : job.error?.message || 'Blender no ha podido completar la tarea.'}</p>}
    {job.status === 'unknown' && <p role="alert">La conexión se interrumpió y no podemos confirmar el resultado. Comprueba Blender antes de iniciar otra tarea.</p>}
    {job.status === 'completed' && <>
      <p role="status">{job.operation === 'render_preview' ? 'Vista previa preparada.' : 'Escena consultada.'}</p>
      {scene && <details className="bln-scene-details"><summary>Detalles de la escena · {scene.objectCount} objetos</summary><dl className="bln-scene"><div><dt>Escena</dt><dd>{scene.name}</dd></div><div><dt>Archivo</dt><dd>{scene.fileName || 'Sin guardar'}</dd></div><div><dt>Objetos</dt><dd>{scene.objectCount}</dd></div></dl></details>}
      {showPreview && path && <PrivatePreview key={`${account}:${path}`} path={path} account={account} />}
      {showPreview && job.operation === 'render_preview' && !path && <p role="alert">La vista previa no está disponible.</p>}
    </>}
  </div>;
}

export const blenderJobError = (error: unknown) => errorMessage(error, 'No hemos podido consultar la tarea de Blender.');
