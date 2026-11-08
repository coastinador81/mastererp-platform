import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { extensionOf } from '../model/documents';
import type { DocumentEntry, DocumentStatus } from '../hooks/useDocumentProcessor';

/** Tipo de archivo solo por la forma del icono (neutro); éxito y error son los únicos estados con color. */
function FileIcon({ name }: { name: string }) {
  const extension = extensionOf(name);
  const tone = ['csv', 'xlsx', 'xls'].includes(extension) ? 'pim-auditoria--sheet'
    : extension === 'pdf' ? 'pim-auditoria--pdf'
      : extension === 'txt' ? 'pim-auditoria--txt'
        : extension === 'json' ? 'pim-auditoria--json'
          : null;
  const icon = extension === 'pdf' || !tone ? 'file' : 'file-text';
  return <span className={clsx('pim-auditoria-file-icon', tone)}><Icon name={icon} size={20} /></span>;
}

function StatusIcon({ status }: { status: DocumentStatus }) {
  if (status === 'success') {
    return <span className="pim-auditoria-file-status pim-auditoria--success" role="img" aria-label="Procesado"><Icon name="check-circle-2" size={16} /></span>;
  }
  if (status === 'error') {
    return <span className="pim-auditoria-file-status pim-auditoria--error" role="img" aria-label="Error"><Icon name="alert-triangle" size={16} /></span>;
  }
  return <span className="pim-auditoria-mini-spinner" role="img" aria-label="Procesando" />;
}

export interface DocumentFileListProps {
  files: DocumentEntry[];
  onRemove: (id: string) => void;
}

/** «Archivos Procesados»: nombre en mono, tamaño, campos encontrados o error, estado y quitar. */
export function DocumentFileList({ files, onRemove }: DocumentFileListProps) {
  return (
    <div className="pim-auditoria-files">
      <h4 className="pim-auditoria-block-title">Archivos Procesados</h4>
      <div className="pim-auditoria-file-list" data-scroll="docs">
        {files.map(entry => (
          <div key={entry.id} className="pim-auditoria-file">
            <FileIcon name={entry.file.name} />
            <div className="pim-auditoria-file-main">
              <p className="pim-auditoria-file-name pim-mono">{entry.file.name}</p>
              <p className="pim-meta">
                <span>{(entry.file.size / 1024).toFixed(1)} KB</span>
                {entry.status === 'success' && entry.extractedData ? (
                  <span className="pim-auditoria-file-ok">{Object.keys(entry.extractedData).length} campos encontrados</span>
                ) : null}
              </p>
              {entry.status === 'error' ? <p className="pim-auditoria-file-err">{entry.error}</p> : null}
            </div>
            <div className="pim-auditoria-file-end">
              <StatusIcon status={entry.status} />
              <button
                type="button"
                className="pim-btn pim-btn-ghost pim-btn-icon pim-btn-sm pim-auditoria-file-remove"
                data-focus={`docs-remove:${entry.id}`}
                aria-label={`Quitar ${entry.file.name}`}
                data-tooltip={`Quitar ${entry.file.name}`}
                data-tooltip-align="end"
                onClick={() => onRemove(entry.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
