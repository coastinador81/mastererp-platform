import type { PublishData, PublishResult } from '@/shared/pim';
import { amazonUpdatePayload, isAmazonListed } from '../model/productMapper';
import type { AmazonListingResponse } from '../model/types';
import { createAmazonListing, updateAmazonListingRequest } from './atributosApi';

/**
 * Publicador de Amazon (prototipo: UonifyPIM.publishers.Amazon en
 * pim/atributos.js). «Publicar» (catalog) hace el mismo envío que «Guardar
 * Cambios» con el canal activo, sin avisos propios: el diálogo enseña el
 * resultado de cada producto.
 */
export async function publishToAmazon(data: PublishData): Promise<PublishResult> {
  let result: AmazonListingResponse;
  if (isAmazonListed(data)) {
    result = await updateAmazonListingRequest(amazonUpdatePayload(data.sku, data));
  } else {
    result = await createAmazonListing(data);
  }
  if (result.status === 'INVALID') {
    throw new Error((result.issues || []).map(issue => issue.message).filter(Boolean).join(' · ') || 'Amazon rechazó el listing');
  }
  if (result.error) throw new Error(result.error);
  return { status: result.status || 'ACCEPTED', issues: Array.isArray(result.issues) ? result.issues : [] };
}
