import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { useOwnedRequest } from '@/shared/hooks';
import { ApiError, errorMessage } from '@/shared/api/client';
import { hasProductEdits, notifyProductChanges, type PimTabKey } from '@/shared/pim';
import { catalogKeys, getCachedProducts, setCachedProducts } from '../api/queries';
import { getProductPreparation, preparationKey, updateProductPreparation, type PreparationUpdate, type ProductPreparation } from '../api/preparation';

/** Una respuesta tardía nunca actualiza otra cuenta ni la ficha que la reemplazó. */
export function useProductPreparation(account: string, sku: string) {
  const client = useQueryClient();
  const owned = useOwnedRequest(account, currentAccountEmail);
  const lock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const key = preparationKey(account, sku);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => owned.read(next => getProductPreparation(sku, next), signal),
    enabled: !!account, retry: false, refetchOnWindowFocus: false });
  const save = async (update: PreparationUpdate) => {
    if (lock.current || !owned.current()) return null;
    const current = getCachedProducts(client).find(product => product.sku === sku) ?? query.data?.product ?? null;
    if (hasProductEdits(current)) { setError('Guarda primero los cambios del editor de esta ficha. Tus respuestas de preparación se conservan.'); return null; }
    const task = owned.begin();
    if (!task) return null;
    lock.current = true; setSaving(true); setError(''); setConflict(false);
    try {
      const result = await updateProductPreparation(sku, update, task.signal);
      task.check();
      await client.cancelQueries({ queryKey: key });
      task.check();
      const currentPreparation = client.getQueryData<ProductPreparation>(key);
      if (!currentPreparation || Number(currentPreparation.product.revision) <= Number(result.product.revision)) client.setQueryData(key, result);
      const latest = getCachedProducts(client).find(product => product.sku === sku);
      if (!latest || Number(latest.revision) <= Number(result.product.revision)) {
        notifyProductChanges([{ product: result.product, previousSku: sku }]);
        setCachedProducts(client, items => items.some(product => product.sku === sku)
          ? items.map(product => product.sku === sku ? result.product : product) : [...items, result.product]);
      }
      void client.invalidateQueries({ queryKey: [...catalogKeys.products, account] });
      return result;
    } catch (reason) {
      if (task.valid()) {
        const changed = reason instanceof ApiError && reason.status === 409;
        setConflict(changed); setError(errorMessage(reason, 'No se han guardado tus respuestas. Puedes volver a intentarlo.'));
        if (changed) void client.invalidateQueries({ queryKey: key });
      }
      return null;
    } finally {
      task.finish();
      if (task.valid()) { lock.current = false; setSaving(false); }
    }
  };
  const saveSection = (section: PimTabKey, revision: number, answers: Record<string, string>, advance: boolean) =>
    save({ revision, mode: 'manual', section, answers, reviewed: advance, advance });
  return { query, saving, error, conflict, saveSection, clearError: () => { setError(''); setConflict(false); } };
}
