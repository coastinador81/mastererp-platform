import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Icon } from '@/shared/ui';
import { driveApi } from '../api/driveApi';
import { MATERIAL_START_CONSENT_COPY } from '../model/materialAnalysisConsent';
import { driveFolderId } from '../model/folderId';

interface Props { account: string; disabled: boolean; initialFolderId?: string; onSelect: (folderId: string) => void; identifyOnly?: boolean }
export function DriveFolderPicker({ account, disabled, initialFolderId, onSelect, identifyOnly = false }: Props) {
  const id = useId();
  const [input, setInput] = useState(initialFolderId ? `https://drive.google.com/drive/folders/${initialFolderId}` : '');
  const [browse, setBrowse] = useState(false);
  const [path, setPath] = useState([{ id: 'root', name: 'Mi unidad' }]);
  const [page, setPage] = useState<string>();
  const [error, setError] = useState('');
  const parent = path.at(-1)!;
  const files = useQuery({ queryKey: ['drive-folders', account, parent.id, page], queryFn: () => driveApi.files(parent.id, '', page), enabled: browse, retry: false });
  const folders = files.data?.files.filter(file => file.mimeType === 'application/vnd.google-apps.folder') ?? [];
  const folderReady = Boolean(driveFolderId(input));
  return <div className="drive-analysis-picker">
    <form onSubmit={event => {
      event.preventDefault();
      const folderId = driveFolderId(input);
      if (!folderId) { setError('Pega el enlace de una carpeta de Google Drive o su identificador.'); return; }
      setError(''); onSelect(folderId);
    }}>
      <label htmlFor={`${id}-folder`}>{MATERIAL_START_CONSENT_COPY.label}</label>
      <input id={`${id}-folder`} value={input} onChange={event => { setInput(event.target.value); setError(''); }} placeholder="https://drive.google.com/drive/folders/…" maxLength={500} disabled={disabled} />
      {identifyOnly ? <p>Primero identificaremos la carpeta y su nombre, sin leer los documentos ni consumir IA. Después podrás confirmar el producto y autorizar el análisis.</p> : <>
        <p>{MATERIAL_START_CONSENT_COPY.description}</p>
        <p>{MATERIAL_START_CONSENT_COPY.budget}</p>
      </>}
      <div className="drive-analysis-actions">
        <button type="button" disabled={disabled} aria-expanded={browse} onClick={() => setBrowse(!browse)}>Explorar Drive</button>
        {folderReady && <button type="submit" disabled={disabled}><Icon name="uony" size={17} />{identifyOnly ? 'Elegir carpeta' : MATERIAL_START_CONSENT_COPY.action}</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
    {browse && <div className="drive-analysis-browser">
      <nav aria-label="Carpetas de Drive">{path.map((part, index) => <button key={part.id} disabled={disabled} onClick={() => { setPath(path.slice(0, index + 1)); setPage(undefined); }}>{part.name}</button>)}</nav>
      {files.isPending ? <p role="status">Cargando carpetas…</p> : files.isError ? <p role="alert">{errorMessage(files.error)} <button onClick={() => void files.refetch()}>Reintentar</button></p> : <>
        <ul>{folders.map(folder => <li key={folder.id}><button disabled={disabled} onClick={() => { setPath([...path, { id: folder.id, name: folder.name }]); setPage(undefined); }}><Icon name="folder" size={17} />{folder.name}</button></li>)}</ul>
        {!folders.length && <p>No hay subcarpetas en esta página.</p>}
        <div className="drive-analysis-actions">{page && <button disabled={disabled} onClick={() => setPage(undefined)}>Primera página</button>}{files.data?.nextPageToken && <button disabled={disabled} onClick={() => setPage(files.data!.nextPageToken!)}>Siguiente página</button>}</div>
      </>}
      {parent.id !== 'root' && <button disabled={disabled} onClick={() => { setInput(parent.id); setBrowse(false); setError(''); }}>Elegir «{parent.name}»</button>}
    </div>}
  </div>;
}
