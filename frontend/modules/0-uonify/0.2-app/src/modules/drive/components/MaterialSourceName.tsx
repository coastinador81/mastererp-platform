import type { MaterialSource } from '../api/productMaterials';

/** Construimos la ruta oficial; nunca abrimos una URL suministrada por el contenido. */
export function MaterialSourceName({ source }: { source?: Pick<MaterialSource, 'id' | 'name'> }) {
  const label = source?.name ?? 'Fuente del análisis';
  if (!source || !/^[A-Za-z0-9_-]{10,200}$/.test(source.id)) return <span>{label}</span>;
  return <a className="drive-analysis-source-link" href={`https://drive.google.com/file/d/${source.id}/view`} target="_blank" rel="noopener noreferrer"
    title="Abrir original en Google Drive (se abre en otra pestaña)">{label}</a>;
}
