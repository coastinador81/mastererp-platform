import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { useCloudWindow, GoogleAccountRule } from '@/modules/cloud';
import { driveApi, type DriveFile } from '../api/driveApi';
import '../styles/drive.css';
const folderType = 'application/vnd.google-apps.folder';

export function DriveConnection({ account }: { account: string }) {
  const state = useQuery({ queryKey: ['google-drive', account], queryFn: driveApi.state, retry: false, staleTime: 0 });
  const connected = state.data?.connection.status === 'connected';
  const materials = useQuery({ queryKey: ['drive-materials', account, state.data?.connection.email], queryFn: driveApi.materials, enabled: connected, retry: false });
  const [path, setPath] = useState([{ id: 'root', name: 'Mi Drive' }]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retryUpload, setRetryUpload] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState<'browse' | 'selected'>('browse');
  const upload = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ file: File; id: string } | null>(null);
  const parent = path[path.length - 1].id;
  const files = useQuery({ queryKey: ['drive-files', account, state.data?.connection.email, parent, query, page], queryFn: () => driveApi.files(parent, query, page), enabled: connected && !!state.data?.accessAllowed, retry: false, staleTime: 0 });
  const popup = useCloudWindow(async () => {
    await state.refetch({ throwOnError: true }); setPath([{ id: 'root', name: 'Mi Drive' }]); setPage(undefined); setQuery('');
  }, 'google-drive');
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(errorMessage(error)); await state.refetch(); }
    finally { setBusy(false); }
  };
  const send = () => run(async () => {
    if (!attempt.current) return;
    const { file, id } = attempt.current;
    if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera los 20 MB.');
    await driveApi.upload(file, id); attempt.current = null; setRetryUpload(false);
    if (upload.current) upload.current.value = '';
    await materials.refetch(); await files.refetch();
    setTab('selected'); setMessage('Archivo guardado en la carpeta Uonify de tu Drive y añadido a tus materiales.');
  });
  const select = (file: DriveFile) => {
    if (file.mimeType === folderType) { setPath([...path, { id: file.id, name: file.name }]); setSearch(''); setQuery(''); setPage(undefined); return; }
    void run(async () => { await driveApi.select(file.id); await materials.refetch(); setMessage('Archivo añadido a tus materiales.'); });
  };
  if (state.isPending) return <p role="status">Recuperando Google Drive…</p>;
  if (state.isError) return <div><p role="alert">No podemos recuperar Drive.</p><button className="uon-onboard-back" onClick={() => void state.refetch()}>Reintentar</button></div>;
  const disabled = busy || !!popup.pending || !state.data.accessAllowed;
  const selected = new Set(materials.data?.files.map(file => file.id));
  return <section className="drv-connect" aria-label="Google Drive">
    <header><p className="drv-eyebrow">TUS ARCHIVOS, CONTIGO</p><h3>Conecta tus ideas con Uonify</h3><p>Elige los archivos de tus productos o sube nuevos materiales a tu Google Drive.</p></header>
    <GoogleAccountRule account={account} />
    {!state.data.accessAllowed && <p role="status">Necesitas una prueba o suscripción vigente para utilizar Drive.</p>}
    {!connected && !popup.pending && <div className="drv-authorize"><p>Google te pedirá permiso para consultar tus archivos. Uonify subirá los nuevos a su propia carpeta, sin modificar tus originales.</p><button className="uon-profile-submit" disabled={disabled || !state.data.available} onClick={() => void popup.open('authorization')}>{state.data.connection.status === 'reauthorize' ? 'Volver a autorizar Drive' : 'Conectar Google Drive'}</button></div>}
    {popup.pending && <div className="drv-authorize"><strong>Seguimos aquí, en Uonify</strong><p>Autoriza Google Drive en la ventana de Google. Al terminar, aparecerán aquí tus archivos.</p><div className="drv-actions"><button className="uon-onboard-back" onClick={popup.focus}>Ver ventana de Google</button><button className="uon-onboard-back" onClick={() => void popup.resume()}>Cancelar conexión</button></div></div>}
    {connected && <>
      <div className="drv-account"><span><strong>Google Drive conectado</strong><small>{state.data.connection.email}</small></span><span className="cld-badge">Conectado</span></div>
      <div className="drv-actions drv-tabs" aria-label="Archivos de Google Drive"><button aria-pressed={tab === 'browse'} onClick={() => setTab('browse')}>Explorar Drive</button><button aria-pressed={tab === 'selected'} onClick={() => setTab('selected')}>Mis materiales{materials.data ? ` · ${materials.data.files.length}` : ''}</button></div>
      {tab === 'browse' ? <>
        <form className="drv-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(undefined); }}><label className="pim-sr-only" htmlFor="drive-search">Buscar en Drive</label><input id="drive-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar un archivo o carpeta" maxLength={200} /><button disabled={disabled}>Buscar</button></form>
        <nav className="drv-breadcrumb" aria-label="Carpeta de Drive">{path.map((part, index) => <button key={part.id} disabled={disabled} onClick={() => { setPath(path.slice(0, index + 1)); setQuery(''); setSearch(''); setPage(undefined); }}>{part.name}</button>)}</nav>
        {query && <p>Resultados en Drive para «{query}»</p>}
        {files.isPending ? <p role="status">Consultando archivos…</p> : files.isError ? <p role="alert">{errorMessage(files.error)} <button onClick={() => void files.refetch()}>Reintentar</button></p> : <>
          <ul className="drv-files">{files.data?.files.map(file => <li key={file.id}><span className="drv-file-icon" aria-hidden="true">{file.mimeType === folderType ? '▱' : '▤'}</span><span className="drv-file-name">{file.name}<small>{file.mimeType === folderType ? 'Carpeta' : file.size ? `${Math.max(1, Math.round(Number(file.size) / 1024))} KB` : 'Documento de Google'}</small></span><button disabled={disabled || selected.has(file.id)} onClick={() => select(file)}>{file.mimeType === folderType ? 'Abrir' : selected.has(file.id) ? 'Añadido' : 'Añadir'}</button></li>)}</ul>
          {files.data?.files.length === 0 && <p>No hay archivos en esta vista. Puedes subir tus materiales o buscar otra carpeta.</p>}
          <div className="drv-actions">{page && <button disabled={disabled} onClick={() => setPage(undefined)}>Volver al principio</button>}{files.data?.nextPageToken && <button disabled={disabled} onClick={() => setPage(files.data!.nextPageToken!)}>Siguientes archivos →</button>}</div>
        </>}
      </> : materials.isError ? <p role="alert">No podemos recuperar tus materiales. <button onClick={() => void materials.refetch()}>Reintentar</button></p> : <>
        <p>Estos archivos están seleccionados para tu trabajo en Uonify. Se mantienen en tu Drive.</p>
        <ul className="drv-files">{materials.data?.files.map(file => <li key={file.id}><span className="drv-file-name">{file.name}</span><a href={`/api/connections/google-drive/materials/${encodeURIComponent(file.id)}/content`} download>Descargar</a><button disabled={disabled} aria-label={`Retirar ${file.name}`} onClick={() => void run(async () => { await driveApi.remove(file.id); await materials.refetch(); })}>Retirar</button></li>)}</ul>
        {materials.data?.files.length === 0 && <p>Aún no has seleccionado archivos.</p>}
      </>}
      <div className="drv-upload"><input ref={upload} type="file" hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.docx,.xlsx,.mp4" onChange={event => { const file = event.target.files?.[0]; if (file) { attempt.current = { file, id: crypto.randomUUID() }; setRetryUpload(true); void send(); } }} /><button className="uon-profile-submit" disabled={disabled} onClick={() => upload.current?.click()}>{busy ? 'Guardando…' : 'Subir archivo a Drive'}</button>{retryUpload && !busy && <button onClick={() => void send()}>Reintentar carga</button>}<small>Se guardará en tu carpeta Uonify. Hasta 20 MB por archivo en esta carga.</small></div>
      <details className="cld-details"><summary>Gestionar Google Drive</summary><p>Desconectar detiene el acceso desde Uonify. Tus archivos originales se conservan. También puedes retirar el permiso desde tu cuenta de Google.</p>{confirm && <p>¿Desconectar esta cuenta de Drive?</p>}<button className="uon-onboard-back" disabled={busy || !!popup.pending} onClick={() => confirm ? void run(async () => { await driveApi.disconnect(); await state.refetch(); setConfirm(false); }) : setConfirm(true)}>{confirm ? 'Confirmar desconexión' : 'Desconectar Drive'}</button>{confirm && <button className="uon-onboard-back" onClick={() => setConfirm(false)}>Mantener conexión</button>}</details>
    </>}
    {(message || popup.message) && <p role="status" className="drv-feedback">{message || popup.message}</p>}
  </section>;
}
