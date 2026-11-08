import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { pimStore, PimTabProvider, type PimEdited, type PimProduct, type PimTabContext } from '@/shared/pim';
import { Toaster } from '@/shared/ui';
import { tab } from '../index';

/** Contexto de ficha mínimo (el que construye el módulo catalog) sobre el almacén real. */
export function makeContext(key = 'TEST-1', product: PimProduct | null = { sku: 'TEST-1', name: 'Producto de prueba', customFields: [] }) {
  const store = pimStore.scope(key);
  const edit = vi.fn((patch: PimEdited) => {
    store.update<PimEdited>('edited', previous => ({ ...previous, ...patch }), {});
  });
  const context: PimTabContext = {
    key,
    isNew: product === null,
    product,
    store,
    draft: () => ({ ...(product ?? {}), ...store.get<PimEdited>('edited', {}) }),
    edit,
    persist: vi.fn(),
    skuTaken: () => false,
    channels: () => ({ Amazon: false }),
    switchTab: vi.fn(),
  };
  return { context, edit, store };
}

/** Pinta la pestaña «Auditoría IA» (la definición exportada por index.ts) con avisos. */
export function renderTab(context: PimTabContext) {
  const Tab = tab.component;
  return render(
    <PimTabProvider value={context}>
      <Toaster />
      <div className="pim-tab pim-tab-auditoria">
        <Tab />
      </div>
    </PimTabProvider>,
  );
}
