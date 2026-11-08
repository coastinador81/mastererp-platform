import { useTabContext, type PimEdited } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { T, hasUnconfirmed } from '../model/fields';
import { newProductDraft } from '../model/productValues';
import type { CustomFieldsApi } from '../hooks/useCustomFields';
import type { useAtributosActions } from '../hooks/useAtributosActions';
import { AtrSectionHead } from './AtrSectionHead';
import { CategoryCombo } from './CategoryCombo';
import { CustomFieldsSection } from './CustomFieldsSection';
import { NumberField } from './NumberField';
import { TitleAiButton } from './TitleAiButton';

/**
 * «Nuevo Producto» (ProductForm.tsx, mode="create"): información, precios,
 * campos personalizados y «Crear Producto», la única acción sólida.
 */
export function CreateView({ uid, edited, fieldsApi, actions }: {
  uid: string;
  edited: PimEdited;
  fieldsApi: CustomFieldsApi;
  actions: ReturnType<typeof useAtributosActions>;
}) {
  const ctx = useTabContext();
  const d = newProductDraft(edited);
  const { fields } = fieldsApi;
  const blocked = fields.length > 0 && hasUnconfirmed(fields);
  const edit = (name: string) => (event: { target: { value: string } }) => ctx.edit({ [name]: event.target.value });
  return (
    <>
      <section className="pim-section pim-atributos-section" aria-labelledby={`${uid}-info`}>
        <AtrSectionHead id={`${uid}-info`} icon="package" title={T.productInformation} />
        <div className="pim-grid-2 pim-atributos-grid-2">
          <div className="pim-field">
            <div className="pim-atributos-label-row">
              <label className="pim-label" htmlFor={`${uid}-name`}>Título del Producto</label>
              <TitleAiButton generating={actions.generatingTitle} onClick={actions.generateTitle} />
            </div>
            <input id={`${uid}-name`} className="pim-input" type="text" data-draft="name" value={d.name} placeholder="Título del Producto" autoComplete="off" onChange={edit('name')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${uid}-sku`}>SKU</label>
            <input id={`${uid}-sku`} className="pim-input pim-mono" type="text" data-draft="sku" value={d.sku} placeholder="SKU único..." autoComplete="off" spellCheck={false} onChange={edit('sku')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${uid}-brand`}>Marca</label>
            <input id={`${uid}-brand`} className="pim-input" type="text" data-draft="brand" value={d.brand} placeholder="Marca" autoComplete="off" onChange={edit('brand')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" id={`${uid}-category-label`} htmlFor={`${uid}-category`}>Categoría</label>
            <CategoryCombo uid={uid} category={d.category} />
          </div>
        </div>
      </section>
      <section className="pim-section pim-atributos-section" aria-labelledby={`${uid}-pricing`}>
        <AtrSectionHead id={`${uid}-pricing`} icon="dollar-sign" title="Precios" />
        <div className="pim-grid-3 pim-atributos-grid-3">
          <NumberField uid={uid} name="price" label="Precio de Venta" value={d.price || ''} placeholder="0.00" />
          <NumberField uid={uid} name="cost" label="Costo" value={d.cost || ''} placeholder="0.00" />
          <NumberField uid={uid} name="stock" label="Stock" value={d.stock || ''} placeholder="0" />
        </div>
      </section>
      <CustomFieldsSection uid={uid} isNew api={fieldsApi} onFieldAI={actions.generateFieldTitle} />
      <div className="pim-atributos-footer">
        <p className="pim-atributos-warning" data-atr-warning="" hidden={!blocked}>
          ⚠️ Confirma todos los campos personalizados antes de crear el producto
        </p>
        <button
          type="button"
          className="pim-btn pim-btn-primary pim-atributos-submit"
          data-action="create"
          disabled={actions.saving || !String(d.name).trim() || !String(d.sku).trim() || blocked}
          onClick={actions.createProduct}
        >
          <Icon name="package" size={16} />
          {actions.saving ? 'Guardando…' : T.saveAndCreate}
        </button>
      </div>
    </>
  );
}
