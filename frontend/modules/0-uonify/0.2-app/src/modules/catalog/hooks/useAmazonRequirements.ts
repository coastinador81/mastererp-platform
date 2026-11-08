import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { useOwnedRequest } from '@/shared/hooks';
import { ApiError, errorMessage } from '@/shared/api/client';
import { hasProductEdits, notifyProductChanges } from '@/shared/pim';
import { getCachedProducts, setCachedProducts } from '../api/queries';
import { preparationKey } from '../api/preparation';
import { amazonRequirementsKey, configureAmazonRequirements, getAmazonRequirements, saveAmazonRequirements, prepareAmazonRequirements,
  type AmazonRequirements, type AmazonRequirementsAnswers, type AmazonRequirementsSource, type AmazonRequirementsPreparation } from '../api/amazonRequirements';

export function useAmazonRequirements(account: string, sku: string, attribute = '') {
  const client = useQueryClient();
  const owned = useOwnedRequest(account, currentAccountEmail);
  const lock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const key = [...amazonRequirementsKey(account, sku), attribute];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => owned.read(next => getAmazonRequirements(sku, next, attribute), signal),
    enabled: !!account, retry: false, refetchOnWindowFocus: false,
    refetchInterval: state => state.state.status !== 'error' && ['queued', 'running'].includes(state.state.data?.evaluation.reasoning?.status ?? '') ? 3000 : false });
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: amazonRequirementsKey(account, sku) }); };
    window.addEventListener('uonify:products-changed', refresh);
    return () => window.removeEventListener('uonify:products-changed', refresh);
  }, [client, account, sku]);
  const mutate = async (operation: (signal: AbortSignal) => Promise<AmazonRequirements>) => {
    if (lock.current || !owned.current()) return null;
    const current = getCachedProducts(client).find(product => product.sku === sku) ?? query.data?.product ?? null;
    if (hasProductEdits(current)) { setError('Guarda primero los cambios del editor. Tus respuestas para Amazon se conservan.'); return null; }
    const task = owned.begin(undefined, 120_000);
    if (!task) return null;
    lock.current = true; setSaving(true); setError(''); setConflict(false);
    try {
      const result = await operation(task.signal);
      task.check();
      await client.cancelQueries({ queryKey: key });
      task.check();
      const latest = getCachedProducts(client).find(product => product.sku === sku);
      if (!latest || Number(latest.revision) <= Number(result.product.revision)) {
        setCachedProducts(client, products => products.some(product => product.sku === sku)
          ? products.map(product => product.sku === sku ? result.product : product) : [...products, result.product]);
        notifyProductChanges([{ product: result.product, previousSku: sku }]);
      }
      const defaultKey = [...amazonRequirementsKey(account, sku), ''];
      const saved = client.getQueryData<AmazonRequirements>(defaultKey);
      if (!saved || Number(saved.product.revision) <= Number(result.product.revision)) client.setQueryData(defaultKey, result);
      void client.invalidateQueries({ queryKey: preparationKey(account, sku) });
      return result;
    } catch (reason) {
      if (task.valid()) {
        const changed = reason instanceof ApiError && reason.status === 409;
        setConflict(changed); setError(errorMessage(reason, 'No se han guardado los datos para Amazon. Puedes volver a intentarlo.'));
        if (changed) void client.invalidateQueries({ queryKey: key });
      }
      return null;
    } finally {
      task.finish();
      if (task.valid()) { lock.current = false; setSaving(false); }
    }
  };
  return { query, saving, error, conflict,
    configure: (body: AmazonRequirementsSource) => mutate(signal => configureAmazonRequirements(sku, body, signal)),
    save: (body: AmazonRequirementsAnswers) => mutate(signal => saveAmazonRequirements(sku, body, signal)),
    prepare: (body: AmazonRequirementsPreparation) => mutate(signal => prepareAmazonRequirements(sku, body, signal)),
    clearError: () => { setError(''); setConflict(false); },
  };
}
