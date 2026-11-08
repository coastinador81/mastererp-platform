import { USE_MOCKS } from '@/shared/api/config';
import { toast } from '@/shared/ui';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getChannels, pimStore } from '@/shared/pim';
import { fetchSample } from '../api/queries';
import { publishData } from '../model/publishData';
import { seedSampleSlices } from '../model/sampleSeeding';
import type { CatalogProduct, PublishItem } from '../model/types';
import { useCatalogStore } from './useCatalogStore';

/**
 * «Publicar» (prototipo: openPublish de app-shell.js): el botón de la ficha publica
 * el producto abierto; las casillas del catálogo reúnen varios. Se marcan los canales
 * activos en alguno de ellos; el producto de ejemplo siembra antes sus porciones.
 */
export function usePublishActions() {
  const client = useQueryClient();
  return useCallback(async (products: CatalogProduct[]) => {
    if (!USE_MOCKS) { toast.info('La publicación en Amazon todavía no está disponible. Tu ficha sigue guardada como borrador.'); return; }
    if (!products.length) return;
    await Promise.all(products.map(async product => {
      if (typeof product.sample !== 'string' || !product.sample) return;
      try {
        seedSampleSlices(pimStore.scope(product.sku), await fetchSample(client, product.sample));
      } catch {
        /* Sin el ejemplo, se publica lo que haya en la ficha. */
      }
    }));
    const { channelStates, openPublishDialog } = useCatalogStore.getState();
    const preselect = getChannels()
      .map(channel => channel.id)
      .filter(id => products.some(product => channelStates[product.sku]?.[id] === true));
    const items: PublishItem[] = products.map(product => {
      const data = publishData(product, (key, slice) => pimStore.get(key, slice));
      const images = Array.isArray(data.images) ? data.images : [];
      return { sku: product.sku, name: String(data.name || product.name), image: product.image || images[0] || '', data };
    });
    openPublishDialog({ items, preselect });
  }, [client]);
}
