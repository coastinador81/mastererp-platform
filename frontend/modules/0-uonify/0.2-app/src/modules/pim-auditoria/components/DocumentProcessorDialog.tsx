import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import clsx from 'clsx';
import { Dialog, Icon } from '@/shared/ui';
import type { FieldMap } from '../model/types';
import { DOCUMENT_ACCEPT, mergeExtracted } from '../model/documents';
import { useAuditStore } from '../hooks/useAuditStore';
import { findByFocus } from '../hooks/useAuditFocus';
import { useDocumentProcessor } from '../hooks/useDocumentProcessor';
import { AuditProgress } from './AuditProgress';
import { DocumentFileList } from './DocumentFileList';

export interface DocumentProcessorDialogProps {
  onClose: () => void;
  /** «Aplicar N Campos»: los campos encontrados en los archivos procesados. */
  onApply: (data: FieldMap) => void;
}

/**
 * «Procesamiento Inteligente de Documentos» (DocumentProcessor, E29): la zona abre el
 * selector al hacer clic (como dice su texto), el progreso avanza con cada archivo y se
 * buscan los campos faltantes actuales.
 */
export function DocumentProcessorDialog({ onClose, onApply }: DocumentProcessorDialogProps) {
  const { read } = useAuditStore();
  const getMissing = useCallback(() => read().missingFields, [read]);
  const { files, processing, progress, processFiles, removeFile } = useDocumentProcessor(getMissing);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const successful = files.filter(entry => entry.status === 'success');
  const applyCount = Object.keys(mergeExtracted(files)).length;

  const pick = () => inputRef.current?.click();
  const onDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActive(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    void processFiles(Array.from(event.dataTransfer?.files ?? []));
  };
  const remove = (id: string) => {
    removeFile(id);
    findByFocus(contentRef.current, 'docs-pick')?.focus();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={<span>Procesamiento Inteligente de Documentos</span>}
      description="Sube documentos (CSV, XLSX, PDF, TXT, JSON) para extraer automáticamente los datos faltantes"
      size="lg"
      className="pim-auditoria-dialog"
      footer={successful.length > 0 ? (
        <>
          <button type="button" className="pim-btn pim-btn-outline" onClick={onClose}>Cancelar</button>
          <button type="button" className="pim-btn pim-btn-primary" onClick={() => onApply(mergeExtracted(files))}>
            <Icon name="check-circle-2" size={16} />Aplicar {applyCount} Campos
          </button>
        </>
      ) : undefined}
    >
      <div className="pim-auditoria-modal pim-auditoria-docs">
        <div className="pim-auditoria-modal-content" ref={contentRef}>
          <div
            className={clsx('pim-dropzone pim-auditoria-docs-zone', active && 'pim-auditoria--active')}
            data-docs-zone
            onClick={pick}
            onDragEnter={onDrag}
            onDragOver={onDrag}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <Icon name="upload" size={32} />
            <div className="pim-auditoria-docs-copy">
              <h3 className="pim-auditoria-docs-title">Arrastra archivos aquí o haz clic para seleccionar</h3>
              <p className="pim-hint">Formatos soportados: CSV, XLSX, PDF, TXT, JSON</p>
            </div>
            {/* El clic sube hasta la zona, que abre el selector una sola vez. */}
            <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-focus="docs-pick" aria-controls={inputId} data-autofocus>
              Seleccionar Archivos
            </button>
          </div>
          {processing ? <AuditProgress label="Procesando archivos..." value={progress} /> : null}
          {files.length > 0 ? <DocumentFileList files={files} onRemove={remove} /> : null}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          hidden
          tabIndex={-1}
          onChange={event => {
            const list = event.currentTarget.files;
            if (list) void processFiles(Array.from(list));
            event.currentTarget.value = '';
          }}
        />
      </div>
    </Dialog>
  );
}
