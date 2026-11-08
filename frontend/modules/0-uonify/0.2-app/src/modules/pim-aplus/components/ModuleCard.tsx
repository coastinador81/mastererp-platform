import { useEffect, useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Icon, IconButton } from '@/shared/ui';
import { useAplus, useAplusController } from '../hooks/aplusContext';
import { VALIDATION_DELAY } from '../model/constants';
import type { AplusModule } from '../model/types';
import { AiGeneratorDialog } from './dialogs/AiGeneratorDialog';
import { canPreview, PreviewDialog } from './dialogs/PreviewDialog';
import { UploadDialog } from './dialogs/UploadDialog';
import type { EditorDialogs } from './editors/editorTypes';
import { FourImagesEditor } from './editors/FourImagesEditor';
import { HeaderImageEditor } from './editors/HeaderImageEditor';
import { SpecsEditor } from './editors/SpecsEditor';
import { TextOverlayEditor } from './editors/TextOverlayEditor';

function StatusBadge({ module }: { module: AplusModule }) {
  if (module.isValid) {
    return (
      <span className="pim-badge pim-badge-green pim-aplus-status">
        <Icon name="check-circle" size={12} />
        <span>Válido</span>
      </span>
    );
  }
  const n = (module.validationErrors || []).length;
  return (
    <span className="pim-badge pim-badge-amber pim-aplus-status">
      <Icon name="alert-triangle" size={12} />
      <span>{`${n} error${n !== 1 ? 'es' : ''}`}</span>
    </span>
  );
}

function ValidationErrors({ module }: { module: AplusModule }) {
  const errors = module.validationErrors || [];
  if (module.isValid || errors.length === 0) return null;
  return (
    <div className="pim-alert pim-alert-amber pim-aplus-errors" role="status">
      <Icon name="alert-triangle" size={14} />
      <div className="pim-aplus-errors-body">
        <p className="pim-aplus-errors-title">Errores de validación:</p>
        <div className="pim-aplus-errors-list">
          {errors.map((error, i) => <p key={i}>{`• ${error}`}</p>)}
        </div>
      </div>
    </div>
  );
}

export interface ModuleCardProps {
  id: string;
  index: number;
  onDelete: (id: string) => void;
}

/** Tarjeta de un módulo: número, título, estado, errores de validación y su editor. */
export function ModuleCard({ id, index, onDelete }: ModuleCardProps) {
  const controller = useAplusController();
  const module = useAplus(state => state.modules.find(item => item.id === id));
  const dom = `pim-aplus-m${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [upload, setUpload] = useState<{ index: number | null } | null>(null);
  const [preview, setPreview] = useState(false);
  const [ai, setAi] = useState(false);

  // Cada módulo se valida al montarse y tras cada cambio, con su espera (E14).
  const content = module?.content;
  const type = module?.type;
  useEffect(() => {
    const delay = type ? VALIDATION_DELAY[type] : undefined;
    if (delay === undefined) return undefined;
    const timer = setTimeout(() => controller.validate(id), delay);
    return () => clearTimeout(timer);
  }, [controller, id, content, type]);

  const dialogs = useMemo<EditorDialogs>(() => ({
    openUpload: uploadIndex => setUpload({ index: uploadIndex }),
    openPreview: () => {
      const current = controller.module(id);
      if (current && canPreview(current)) setPreview(true);
    },
    openAi: () => setAi(true),
  }), [controller, id]);

  if (!module) return null;
  return (
    <article
      className={clsx('pim-card pim-aplus-card', module.isValid ? 'pim-aplus-card-valid' : 'pim-aplus-card-invalid')}
      data-module-id={module.id}
      aria-labelledby={`${dom}-title`}
    >
      <header className="pim-aplus-card-head">
        <div className="pim-aplus-card-titles">
          <span className="pim-badge pim-aplus-card-num">{`Módulo ${index + 1}`}</span>
          <h3 className="pim-aplus-card-title" id={`${dom}-title`}>{module.title}</h3>
        </div>
        <div className="pim-toolbar pim-aplus-card-tools">
          <span>
            <StatusBadge module={module} />
          </span>
          <IconButton
            icon="trash"
            label="Eliminar módulo"
            tooltipAlign="end"
            className="pim-aplus-delete"
            data-action="delete-module"
            aria-describedby={`${dom}-title`}
            onClick={() => onDelete(module.id)}
          />
        </div>
      </header>
      <div className="pim-aplus-card-errors">
        <ValidationErrors module={module} />
      </div>
      <div className="pim-aplus-card-body">
        {module.type === 'text-overlay' ? <TextOverlayEditor module={module} dom={dom} dialogs={dialogs} /> : null}
        {module.type === 'specifications' ? <SpecsEditor module={module} dom={dom} dialogs={dialogs} /> : null}
        {module.type === 'four-images' ? <FourImagesEditor module={module} dom={dom} dialogs={dialogs} /> : null}
        {module.type === 'header-image' ? <HeaderImageEditor module={module} dom={dom} dialogs={dialogs} /> : null}
      </div>
      {upload ? <UploadDialog module={module} index={upload.index} onClose={() => setUpload(null)} /> : null}
      {preview ? <PreviewDialog module={module} onClose={() => setPreview(false)} /> : null}
      {ai && module.type === 'text-overlay' ? <AiGeneratorDialog moduleId={module.id} onClose={() => setAi(false)} /> : null}
    </article>
  );
}
