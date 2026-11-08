import { useState } from 'react';
import { pimStore, type PimTabContext } from '@/shared/pim';
import { toast } from '@/shared/ui';

export function LiveProductSave({ context }: { context: PimTabContext }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!context.product || saving) return;
    setSaving(true);
    const edited = context.store.get<Record<string, unknown>>('edited', {});
    const bullets = context.store.get('bullets', context.product.bullets ?? []);
    try {
      const saved = await context.persist({ ...context.product, ...edited, bullets }, { key: context.key });
      // No descartar texto escrito mientras se guardaba.
      if (context.store.get('edited') === edited) pimStore.set(saved.sku, 'edited', {});
      toast.success('Descripciones guardadas');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar las descripciones');
    } finally { setSaving(false); }
  };
  return <div className="live-product-save"><button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar descripciones'}</button></div>;
}
