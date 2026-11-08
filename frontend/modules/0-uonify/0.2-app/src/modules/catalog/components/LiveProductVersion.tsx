import { pimStore, usePimValue, type PimProduct } from '@/shared/pim';
import { dialog } from '@/shared/ui';

export function LiveProductVersion({ product }: { product: PimProduct }) {
  const base = usePimValue<number>(product.sku, 'baseRevision', Number(product.revision));
  if (base === product.revision) return null;
  const reload = async () => {
    if (await dialog.confirm({ title: '¿Descartar tus cambios sin guardar y cargar la última versión?', confirmLabel: 'Cargar versión guardada' })) {
      pimStore.drop(product.sku);
    }
  };
  return <div className="live-product-version" role="status"><p>Esta ficha tiene una versión más reciente. Tus cambios sin guardar se conservan.</p><button type="button" className="secondary-action" onClick={() => void reload()}>Revisar versión guardada</button></div>;
}
