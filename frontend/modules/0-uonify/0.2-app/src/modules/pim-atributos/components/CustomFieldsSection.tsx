import { Icon } from '@/shared/ui';
import { T } from '../model/fields';
import type { CustomFieldsApi } from '../hooks/useCustomFields';
import { AtrSectionHead } from './AtrSectionHead';
import { FieldCard } from './FieldCard';

/** «Campos Personalizados»: una sola superficie de lista, filas separadas por filetes. */
export function CustomFieldsSection({ uid, isNew, api, onFieldAI }: {
  uid: string;
  isNew: boolean;
  api: CustomFieldsApi;
  onFieldAI: (id: string) => void;
}) {
  const titleId = `${uid}-custom-title`;
  return (
    <section className="pim-section pim-atributos-section" aria-labelledby={titleId}>
      <AtrSectionHead
        id={titleId}
        icon="layers"
        title={T.customFields}
        actions={(
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" data-action="add-field" onClick={api.add}>
            <Icon name="plus" size={14} />
            {T.addCustomField}
          </button>
        )}
      />
      <div data-fields="">
        {api.fields.length === 0 ? (
          <div className="pim-card pim-card-dashed pim-empty pim-atributos-empty">
            <Icon name="layers" size={24} />
            <strong className="pim-atributos-empty-title">No hay campos personalizados</strong>
            <span className="pim-atributos-empty-sub">Agrega campos para personalizar tu producto</span>
          </div>
        ) : (
          <div className="pim-atributos-fields">
            {api.fields.map((field, index) => (
              <FieldCard
                key={field.id}
                field={field}
                baseId={`${uid}-f${index}`}
                isNew={isNew}
                entering={api.isEntering(field.id)}
                api={api}
                onFieldAI={onFieldAI}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
