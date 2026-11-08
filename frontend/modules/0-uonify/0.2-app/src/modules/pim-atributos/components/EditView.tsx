import type { RefObject } from 'react';
import { useTabContext, type PimEdited } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { hasUnconfirmed } from '../model/fields';
import { currentValues } from '../model/productValues';
import type { CustomFieldsApi } from '../hooks/useCustomFields';
import type { useAtributosActions } from '../hooks/useAtributosActions';
import { useProductStock } from '../hooks/useProductStock';
import { AtrSectionHead } from './AtrSectionHead';
import { CategoryCombo } from './CategoryCombo';
import { CustomFieldsSection } from './CustomFieldsSection';
import { NumberField } from './NumberField';
import { StockSelect } from './StockSelect';
import { TitleAiButton } from './TitleAiButton';

/**
 * Edición de un producto guardado: nombre, SKU, marca y categoría; precio,
 * coste y stock; campos personalizados y «Guardar Cambios».
 */
export function EditView({ uid, edited, fieldsApi, actions, saveButtonRef }: {
  uid: string;
  edited: PimEdited;
  fieldsApi: CustomFieldsApi;
  actions: ReturnType<typeof useAtributosActions>;
  saveButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const ctx = useTabContext();
  const product = ctx.product;
  const current = currentValues(edited, product);
  const stock = useProductStock(ctx, product);
  const { fields } = fieldsApi;
  const confirmedCount = fields.filter(field => field.isConfirmed).length;
  const edit = (name: string) => (event: { target: { value: string } }) => ctx.edit({ [name]: event.target.value });
  return (
    <>
      <div className="pim-section pim-atributos-section">
        <div className="pim-grid-2 pim-atributos-grid-2">
          <div className="pim-field">
            <div className="pim-atributos-label-row">
              <label className="pim-label" htmlFor={`${uid}-name`}>Nombre del Producto</label>
              <TitleAiButton generating={false} onClick={actions.generateTitle} />
            </div>
            <input id={`${uid}-name`} className="pim-input" type="text" data-draft="name" value={current.name} autoComplete="off" onChange={edit('name')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${uid}-sku`}>SKU</label>
            <input id={`${uid}-sku`} className="pim-input pim-mono" type="text" data-draft="sku" value={current.sku} autoComplete="off" spellCheck={false} onChange={edit('sku')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${uid}-brand`}>Marca</label>
            <input id={`${uid}-brand`} className="pim-input" type="text" data-draft="brand" value={current.brand} autoComplete="off" onChange={edit('brand')} />
          </div>
          <div className="pim-field">
            <label className="pim-label" id={`${uid}-category-label`} htmlFor={`${uid}-category`}>Categoría</label>
            <CategoryCombo uid={uid} category={current.category} />
          </div>
        </div>
      </div>
      <section className="pim-section pim-atributos-section" aria-labelledby={`${uid}-attributes`}>
        <AtrSectionHead id={`${uid}-attributes`} icon="dollar-sign" title="Atributos del Producto" />
        <div className="pim-grid-3 pim-atributos-grid-3">
          <NumberField uid={uid} name="price" label="Precio de Venta (PVPR)" value={current.price} placeholder="0.00" />
          <NumberField uid={uid} name="cost" label="Costo" value={current.cost} placeholder="0.00" />
          {product?.source === 'amazon' ? (
            <div className="pim-field">
              <label className="pim-label" htmlFor={`${uid}-stock`}>Stock</label>
              <div data-stock-holder="">
                <StockSelect id={`${uid}-stock`} available={stock.available} loading={stock.loading} updating={stock.updating} onChange={value => void stock.changeStock(value)} />
              </div>
            </div>
          ) : (
            <NumberField uid={uid} name="stock" label="Stock" value={current.stock} placeholder="0" />
          )}
        </div>
      </section>
      <CustomFieldsSection uid={uid} isNew={false} api={fieldsApi} onFieldAI={actions.generateFieldTitle} />
      <div className="pim-atributos-footer">
        <p className="pim-atributos-warning" data-atr-warning="" hidden={!(fields.length > 0 && hasUnconfirmed(fields))}>
          ⚠️ Confirma todos los campos personalizados antes de guardar
        </p>
        <button
          ref={saveButtonRef}
          type="button"
          className="pim-btn pim-btn-primary pim-atributos-submit"
          data-action="save"
          disabled={actions.saving || hasUnconfirmed(fields)}
          aria-busy={actions.saving}
          onClick={actions.saveChanges}
        >
          <Icon name="save" size={16} />
          <span>Guardar Cambios<span data-save-count="">{fields.length > 0 ? ` (${confirmedCount})` : ''}</span></span>
        </button>
      </div>
    </>
  );
}
