import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import type { AuditState } from '../model/types';
import { DEFAULT_AUDIT, withDefaults } from '../model/schemas';
import { mapScrapedProduct, scrapedProductError, scrapeInputError } from '../model/scrape';
import { scrapeErrorMessage, scrapeProduct } from './auditApi';

/**
 * Trabajos de la auditoría que siguen aunque se cambie de pestaña: escriben en el
 * ámbito del producto (usePimScope), que sigue al producto si se renombra al crearlo
 * (E05/MF3: en «Nuevo Producto» todo queda bajo el producto que se crea).
 */

/** La porción `audit` actual del ámbito, con sus valores por defecto. */
export const readAudit = (scope: PimScope): AuditState => withDefaults(scope.get('audit'));

/** Mezcla `patch` en la porción `audit`. */
export function patchAudit(scope: PimScope, patch: Partial<AuditState>): void {
  scope.update<AuditState>('audit', prev => ({ ...withDefaults(prev), ...patch }), DEFAULT_AUDIT);
}

/**
 * Análisis en curso por producto. La porción dura la sesión: si se recarga a mitad,
 * al montar la pestaña se quita isScrapingActive para no dejar la URL bloqueada.
 */
const scrapingInFlight = new Set<PimScope>();

export const isScrapingInFlight = (scope: PimScope): boolean => scrapingInFlight.has(scope);

/**
 * handleStartScraping (paso «1. Analiza»): extrae los datos del producto y deja la
 * categoría sugerida (o 'General') y los campos editables.
 */
export async function runScrape(scope: PimScope, productId?: string): Promise<void> {
  const input = readAudit(scope).auditUrl || '';
  const inputError = scrapeInputError(input);
  if (inputError) {
    toast.error(inputError);
    return;
  }
  scrapingInFlight.add(scope);
  patchAudit(scope, {
    isScrapingActive: true, scrapingProgress: 0, scrapingError: null, suggestedCategory: null, isCategoryConfirmed: null, showSchemaComparison: false,
  });
  try {
    patchAudit(scope, { scrapingProgress: 20 });
    toast.info('Analizando URL del producto...');
    const scraped = await scrapeProduct(input, productId);
    const invalid = scrapedProductError(scraped);
    if (invalid || !scraped) throw new Error(invalid ?? undefined);
    patchAudit(scope, { scrapingProgress: 60 });
    toast.info('Procesando datos extraídos...');
    const mapped = mapScrapedProduct(scraped);
    patchAudit(scope, { scrapedData: mapped, suggestedCategory: scraped.suggested_category || 'General', scrapingProgress: 80 });
    patchAudit(scope, { mappedFields: mapped, editableFields: mapped, scrapingProgress: 100 });
    toast.success(`¡Análisis completado! ${Object.keys(mapped).length} campos extraídos.`);
  } catch (error) {
    const message = scrapeErrorMessage(error);
    patchAudit(scope, { scrapingError: message });
    toast.error(`Error: ${message}`);
  } finally {
    scrapingInFlight.delete(scope);
    patchAudit(scope, { isScrapingActive: false });
  }
}
