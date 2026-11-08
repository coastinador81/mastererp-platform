import { render } from '@testing-library/react';
import { pimStore, PimTabHost, type PimProduct, type PimTabContext } from '@/shared/pim';
import { tab } from '../index';
import type { Model3DFile } from '../model/types';

/** Contexto de ficha mínimo (lo construye catalog en la aplicación). */
export function makeContext(key: string, product: PimProduct | null = null): PimTabContext {
  return {
    key,
    isNew: key === '__new__',
    product,
    store: pimStore.scope(key),
    draft: () => ({ ...(product ?? {}), ...pimStore.get<Record<string, unknown>>(key, 'edited', {}) }),
    edit: patch => { pimStore.update<Record<string, unknown>>(key, 'edited', edited => ({ ...edited, ...patch }), {}); },
    persist: async data => ({ sku: String(data.sku), name: String(data.name) }),
    skuTaken: () => false,
    channels: () => ({ Amazon: false }),
    switchTab: () => {},
  };
}

export function renderTab(key = 'UON-KIT-01', product: PimProduct | null = { sku: 'UON-KIT-01', name: 'Make It Possible' }) {
  return render(<PimTabHost tab={tab} context={makeContext(key, product)} />);
}

/** Modelos del producto de ejemplo (porción model3d.files). */
export const SAMPLE_FILES: Model3DFile[] = [
  ['torre-25-piezas.glb', '/assets/jenga/conjunto-torre-v62.glb', 2140424],
  ['tres-personajes.glb', '/assets/jenga/juego-completo.glb', 1916372],
  ['caja-presentacion.glb', '/assets/packaging-uonify-v56/packaging-refined.glb', 17501164],
].map(([name, url, size]) => ({
  key: `modelos/UON-KIT-01/${name}`,
  url: String(url),
  size: Number(size),
  type: 'model/gltf-binary',
  local: true,
  metadata: { polygons: 9664, texture_resolution: '1024x1024', format: 'GLB', compression: 'Sin compresión', file_size: Number(size) },
}));

/** jsdom no tiene WebGL ni canvas 2D: silencia su aviso «Not implemented». */
export function silenceCanvas() {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
}
