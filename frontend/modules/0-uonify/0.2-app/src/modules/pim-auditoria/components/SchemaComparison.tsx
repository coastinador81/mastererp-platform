import { useId, useState } from 'react';
import { toast } from '@/shared/ui';
import type { FieldMap } from '../model/types';
import { useAuditStore } from '../hooks/useAuditStore';
import { useAuditFocus } from '../hooks/useAuditFocus';
import { useFieldManager } from '../hooks/useFieldManager';
import { useSchemaActions } from '../hooks/useSchemaActions';
import { SchemaSummary } from './SchemaSummary';
import { MissingFields } from './MissingFields';
import { CustomFieldForm } from './CustomFieldForm';
import { SchemaFieldList } from './SchemaFieldList';
import { ApplyMappedFooter } from './ApplyMappedFooter';
import { DocumentProcessorDialog } from './DocumentProcessorDialog';
import { ApiConnectionDialog } from './ApiConnectionDialog';

type OpenDialog = 'docs' | 'api' | null;

/**
 * Pasos 3 y 4 (SchemaComparisonSection + DragDropFieldManager, E20-E30): progreso de
 * validación, datos faltantes con sus dos formas de completarlos, campo personalizado,
 * lista de campos y «Aplicar datos a Atributos».
 */
export function SchemaComparison() {
  const { read } = useAuditStore();
  const { mergeFields } = useSchemaActions();
  const requestFocus = useAuditFocus();
  const manager = useFieldManager();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const summaryTitleId = useId();

  const openIfMissing = (dialog: Exclude<OpenDialog, null>) => {
    if (read().missingFields.length === 0) {
      toast.error('No hay campos faltantes para completar');
      return;
    }
    setOpenDialog(dialog);
  };

  // handleDocumentDataExtracted: el diálogo se cierra siempre; el foco vuelve a
  // «Completar desde documentos» o, si ha quedado deshabilitado, a «Completar con API».
  const applyDocuments = (data: FieldMap) => {
    if (mergeFields(data)) toast.success(`${Object.keys(data).length} campos completados desde documentos`);
    else toast.error('No se encontraron datos relevantes en los documentos');
    setOpenDialog(null);
    requestFocus(['analyze-docs', 'complete-api'], { onlyIfLost: true });
  };

  // handleAPIDataFound (datos de ejemplo de la conexión simulada).
  const applyApiData = (data: FieldMap) => {
    if (mergeFields(data)) toast.success(`${Object.keys(data).length} campos aplicados`);
    else toast.error('No se encontraron datos en la API');
    setOpenDialog(null);
    requestFocus('complete-api', { onlyIfLost: true });
  };

  return (
    <>
      <section className="pim-section" data-region="schema-summary" aria-labelledby={summaryTitleId}>
        <SchemaSummary titleId={summaryTitleId} />
      </section>
      <MissingFields
        draggedFields={manager.draggedFields}
        onDrop={manager.dropField}
        onAnalyzeDocuments={() => openIfMissing('docs')}
        onCompleteWithApi={() => openIfMissing('api')}
      />
      <CustomFieldForm manager={manager} />
      <div className="pim-section pim-auditoria-fields">
        <SchemaFieldList />
        <div className="pim-auditoria-footer" data-region="apply-mapped">
          <ApplyMappedFooter />
        </div>
      </div>
      {openDialog === 'docs' ? <DocumentProcessorDialog onClose={() => setOpenDialog(null)} onApply={applyDocuments} /> : null}
      {openDialog === 'api' ? <ApiConnectionDialog onClose={() => setOpenDialog(null)} onUseData={applyApiData} /> : null}
    </>
  );
}
