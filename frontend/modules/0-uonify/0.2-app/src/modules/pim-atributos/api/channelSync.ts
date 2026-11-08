import type { PimEdited, PimProduct } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { amazonUpdatePayload, isAmazonListed, mapAmazonToShopify, mapInternalToShopify } from '../model/productMapper';
import type { ProductLike } from '../model/types';
import { apiErrorText } from './http';
import {
  checkShopifyDuplicateBySKU,
  createAmazonListing,
  createShopifyProduct,
  updateAmazonListingRequest,
  updateShopifyProductRequest,
} from './atributosApi';

/**
 * Envío a los canales al pulsar «Guardar Cambios» (prototipo: pim/atributos.js,
 * handleSaveChanges; original: hooks/useProductUpdate.ts). Cada paso enseña sus
 * propios avisos, con los textos del original.
 */

const str = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/** useProductUpdate.updateShopifyProduct: true si Shopify lo aceptó. */
export async function updateShopifyProduct(productId: string, data: ProductLike): Promise<boolean> {
  try {
    const keywords = data.keywords;
    const result = await updateShopifyProductRequest(productId, {
      title: data.title || data.name,
      body_html: data.body_html || data.description,
      vendor: data.vendor || data.brand,
      product_type: data.category || data.product_type,
      tags: data.tags || (keywords ? (Array.isArray(keywords) ? keywords.join(', ') : keywords) : undefined),
      variants: data.variants || [{
        sku: data.sku,
        price: data.price === undefined || data.price === null ? undefined : String(data.price),
        inventory_quantity: parseInt(str(data.stock) || '0', 10) || 0,
      }],
      images: data.images || undefined,
      metafields: data.metafields || undefined,
    });
    if (result?.error) {
      toast.error(`❌ ${result.error}`);
      return false;
    }
    toast.success('✅ Producto actualizado en Shopify');
    return true;
  } catch (error) {
    toast.error(`❌ Error: ${apiErrorText(error) || 'Error desconocido'}`);
    return false;
  }
}

/** useProductUpdate.updateAmazonListing: avisos de ACCEPTED (con advertencias), INVALID o error. */
export async function updateAmazonListing(sku: unknown, data: ProductLike): Promise<boolean> {
  try {
    const amazonResponse = await updateAmazonListingRequest(amazonUpdatePayload(sku, data));
    if (amazonResponse.status === 'ACCEPTED') {
      const warnings = (amazonResponse.issues || [])
        .filter(issue => issue.severity === 'WARNING')
        .map(issue => `⚠️ ${issue.message}`)
        .join('\n');
      if (warnings) toast.success('✅ Listing actualizado en Amazon', { description: warnings, duration: 8000 });
      else toast.success('✅ Listing actualizado en Amazon');
      return true;
    }
    if (amazonResponse.status === 'INVALID' && amazonResponse.issues) {
      const messages = amazonResponse.issues
        .map(issue => `${str(issue.code)}: ${str(issue.message)}${issue.attributeName ? ` (${issue.attributeName})` : ''}`)
        .join('\n');
      toast.error('❌ Amazon rechazó la actualización', { description: messages, duration: 8000 });
      return false;
    }
    if (amazonResponse.error) {
      toast.error(`❌ ${amazonResponse.error || 'Error al actualizar listing'}`);
      return false;
    }
    return true; // «Si no hay status ACCEPTED ni error, asumir éxito»
  } catch {
    toast.error('❌ Error al actualizar listing');
    return false;
  }
}

/**
 * Shopify y Amazon, si están activos para el producto. `selected` es el
 * producto guardado cuando empezó el guardado; `dataToSave`, lo que se guarda.
 */
export async function syncChannels(input: {
  channels: { shopify: boolean; amazon: boolean };
  selected: PimProduct;
  edited: PimEdited;
  dataToSave: PimEdited;
}): Promise<void> {
  const { channels, selected, edited, dataToSave } = input;
  if (channels.shopify) {
    const shopifyData = dataToSave.source === 'amazon' ? mapAmazonToShopify(dataToSave) : mapInternalToShopify(dataToSave);
    let shopifyId: string | null = str(selected.shopify_id || selected.id) || null;
    if (!shopifyId || !/^\d+$/.test(shopifyId)) {
      const duplicateId = await checkShopifyDuplicateBySKU(dataToSave.sku);
      if (duplicateId) shopifyId = duplicateId;
    }
    if (shopifyId) {
      await updateShopifyProduct(shopifyId, shopifyData);
    } else {
      const response = await createShopifyProduct(shopifyData);
      if (response?.statusCode === 200) toast.success('✅ Producto creado en Shopify');
    }
  }
  if (channels.amazon) {
    const productType = selected.productType || selected.product_type;
    const amazonData: ProductLike = {
      ...dataToSave,
      name: str(edited.name || selected.name),
      description: edited.description || selected.description,
      productType,
      product_type: productType,
    };
    if (isAmazonListed(selected)) {
      await updateAmazonListing(dataToSave.sku, amazonData);
    } else {
      const response = await createAmazonListing(amazonData);
      if (response.statusCode === 200 || response.status === 'ACCEPTED') toast.success('✅ Listing creado en Amazon');
    }
  }
}
