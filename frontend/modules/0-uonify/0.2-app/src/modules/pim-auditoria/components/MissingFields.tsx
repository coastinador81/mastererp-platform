import { useId, useState, type DragEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { own } from '../model/translations';
import { useAuditStore } from '../hooks/useAuditStore';

export interface MissingFieldsProps {
  draggedFields: string[];
  onDrop: (field: string, options?: { keyboard?: boolean }) => void;
  onAnalyzeDocuments: () => void;
  onCompleteWithApi: () => void;
}

/**
 * «Datos Faltantes» (DragDropFieldManager): las dos formas de completar los datos, la
 * lista para arrastrar (también con clic, Intro o Espacio: E22) y la zona de gestión.
 */
export function MissingFields({ draggedFields, onDrop, onAnalyzeDocuments, onCompleteWithApi }: MissingFieldsProps) {
  const { audit } = useAuditStore();
  const uid = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const schema = audit.uonifySchema;
  const missingFields = audit.missingFields;
  const availableFields = missingFields.filter(field => !draggedFields.includes(field));
  const hintId = `${uid}-drag-hint`;

  const onDragStart = (event: DragEvent<HTMLDivElement>, field: string) => {
    try {
      event.dataTransfer.setData('text/plain', field);
      event.dataTransfer.effectAllowed = 'move';
    } catch {
      /* navegadores antiguos */
    }
    setDragging(field);
  };
  const onDragEnd = () => {
    setDragging(null);
    setOver(false);
  };
  const onZoneDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  const onZoneDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  };
  const onZoneDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    const field = dragging;
    onDragEnd();
    onDrop(field);
  };
  const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, field: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onDrop(field, { keyboard: true });
  };

  return (
    <section className="pim-section" data-region="missing-fields" aria-labelledby={`${uid}-title`}>
      <div className="pim-section-head">
        <div className="pim-auditoria-head-main pim-auditoria-title-row">
          <h3 className={clsx('pim-section-title', availableFields.length > 0 && 'pim-auditoria-title-warn')} id={`${uid}-title`}>
            <Icon name="alert-triangle" size={16} />
            <span>Datos Faltantes ({availableFields.length})</span>
          </h3>
          {availableFields.length === 0 && draggedFields.length > 0 ? (
            <span className="pim-badge pim-badge-green"><Icon name="check-circle-2" size={12} />¡Todos los campos movidos!</span>
          ) : null}
        </div>
        <div className="pim-section-actions">
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-focus="analyze-docs" disabled={missingFields.length === 0} onClick={onAnalyzeDocuments}>
            <Icon name="file-search" size={14} />Completar desde documentos
          </button>
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-focus="complete-api" onClick={onCompleteWithApi}>
            <Icon name="download" size={14} />Completar con API
          </button>
        </div>
      </div>
      {availableFields.length > 0 ? (
        <>
          <p className="pim-hint" id={hintId}>🏷️ Arrastra los campos hacia la zona de gestión para editarlos</p>
          <div className="pim-auditoria-drag-list">
            {availableFields.map(field => {
              const info = own(schema?.fields, field);
              const isRequired = Boolean(schema?.required.includes(field));
              const isOptional = Boolean(schema?.optional.includes(field));
              const hasMeta = Boolean(info?.description || info?.type);
              return (
                <div
                  key={field}
                  className={clsx('pim-auditoria-drag', dragging === field && 'pim-auditoria--dragging')}
                  draggable
                  tabIndex={0}
                  role="button"
                  data-focus={`drag:${field}`}
                  aria-describedby={hintId}
                  onDragStart={event => onDragStart(event, field)}
                  onDragEnd={onDragEnd}
                  onClick={() => onDrop(field, { keyboard: true })}
                  onKeyDown={event => onItemKeyDown(event, field)}
                >
                  <span className="pim-auditoria-grip"><Icon name="grip-vertical" size={16} /></span>
                  <div className="pim-auditoria-drag-main">
                    <div className="pim-auditoria-drag-top">
                      <span className="pim-auditoria-drag-name">{field.replace(/_/g, ' ')}</span>
                      {isRequired ? <span className="pim-badge pim-badge-red">Requerido</span> : null}
                      {isOptional ? <span className="pim-badge">Opcional</span> : null}
                    </div>
                    {hasMeta ? (
                      <div className="pim-meta pim-auditoria-drag-meta">
                        {info?.description ? <span className="pim-auditoria-drag-desc">{info.description}</span> : null}
                        {info?.type ? (
                          <span>
                            Tipo: <span className="pim-mono">{info.type}</span>
                            {info.unit ? <> <span>({info.unit})</span></> : null}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span className="pim-auditoria-grip pim-auditoria-drag-go"><Icon name="arrow-right" size={14} /></span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="pim-empty pim-auditoria-empty">
          <Icon name="check-circle-2" size={24} />
          <strong>No hay campos faltantes</strong>
          <p>Todos los campos han sido completados o movidos</p>
        </div>
      )}
      <div
        className={clsx('pim-auditoria-dropzone', dragging && 'pim-auditoria--can-drop', over && 'pim-auditoria--over')}
        data-drop-zone
        onDragOver={onZoneDragOver}
        onDragLeave={onZoneDragLeave}
        onDrop={onZoneDrop}
      >
        <Icon name="plus" size={20} />
        <h4 className="pim-auditoria-dropzone-title">Zona de Gestión de Campos</h4>
        <p className="pim-auditoria-dropzone-text">Suelta aquí los campos para agregarlos a la gestión</p>
      </div>
    </section>
  );
}
