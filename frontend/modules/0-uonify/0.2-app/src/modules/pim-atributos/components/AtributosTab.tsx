import { useId, useRef } from 'react';
import { usePimSlice, useTabContext, type PimEdited } from '@/shared/pim';
import { useAtributosActions } from '../hooks/useAtributosActions';
import { useCustomFields } from '../hooks/useCustomFields';
import { CreateView } from './CreateView';
import { EditView } from './EditView';
import '../styles/atributos.css';

/**
 * Pestaña «Atributos» (prototipo: pim/atributos.js). En «Nuevo Producto» es el
 * formulario de creación; con un producto guardado, el de edición.
 */
export function AtributosTab() {
  const ctx = useTabContext();
  const uid = `atr${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldsApi = useCustomFields(ctx, rootRef);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const actions = useAtributosActions(ctx, fieldsApi, saveButtonRef);
  const [edited] = usePimSlice<PimEdited>('edited', {});
  const props = { uid, edited: edited || {}, fieldsApi, actions };
  return (
    <div ref={rootRef} className="pim-tab pim-atributos">
      {ctx.isNew ? <CreateView {...props} /> : <EditView {...props} saveButtonRef={saveButtonRef} />}
    </div>
  );
}
