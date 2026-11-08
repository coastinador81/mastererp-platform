import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { scrapeImagesFromUrl } from '../api/imagesApi';
import { MESSAGES } from '../model/labels';
import { stripFile } from '../model/lists';
import type { ImageItem } from '../model/types';
import { imagesMemory } from '../state/memory';
import { multiTenant, scrapedStorageKey } from '../state/multiTenant';
import { mutate } from './gallery';

/**
 * «Extraer Imágenes desde URL» (prototipo: handleImageScraping y runScraping).
 * Progreso simulado del original: cada 200 ms suma Math.random() * 15 hasta el
 * 90 %, llega al 100 % al responder y se oculta 500 ms después.
 */

const PROGRESS_STEP_MS = 200;
const PROGRESS_CAP = 90;
const HIDE_DELAY_MS = 500;

function setProgress(progress: number): void {
  const { scraping } = imagesMemory.getState();
  if (scraping) imagesMemory.setState({ scraping: { ...scraping, progress } });
}

export function handleImageScraping(scope: PimScope, hasProduct: boolean): void {
  const { imageUrl, scraping } = imagesMemory.getState();
  if (!imageUrl.trim()) return;
  if (!hasProduct) {
    toast.error(MESSAGES.selectProduct);
    return;
  }
  if (scraping) return;
  void runScraping(scope, imageUrl.trim());
}

export async function runScraping(scope: PimScope, url: string): Promise<void> {
  imagesMemory.setState({ scraping: { key: scope.key, progress: 0 } });
  mutate(scope, lists => {
    lists.scraped = [];
  });
  const progressInterval = setInterval(() => {
    const { scraping } = imagesMemory.getState();
    if (!scraping) return;
    if (scraping.progress >= PROGRESS_CAP) {
      clearInterval(progressInterval);
      setProgress(PROGRESS_CAP);
    } else setProgress(Math.min(PROGRESS_CAP, scraping.progress + Math.random() * 15));
  }, PROGRESS_STEP_MS);
  try {
    const result = await scrapeImagesFromUrl(url, scope.key);
    setProgress(100);
    const images = Array.isArray(result?.images) ? result.images : [];
    if (images.length > 0) {
      const stamp = Date.now();
      const scrapedImageFiles: ImageItem[] = images.map((imageUrl, index) => ({
        id: `scraped-${stamp}-${index}`,
        url: imageUrl,
        name: `scraped-${index + 1}.jpg`,
        source: 'scrape',
        status: 'pending',
        originalDimensions: null,
        processedDimensions: null,
      }));
      mutate(scope, lists => {
        lists.scraped = [...lists.scraped, ...scrapedImageFiles];
        multiTenant.setItem(scrapedStorageKey(scope.key), lists.scraped.map(stripFile));
      });
      toast.success(MESSAGES.scraped(result.total ?? images.length));
    } else {
      toast.warning(MESSAGES.noImages);
    }
  } catch (error) {
    toast.error(MESSAGES.error((error instanceof Error && error.message) || MESSAGES.scrapeFallback));
  } finally {
    clearInterval(progressInterval);
    setTimeout(() => imagesMemory.setState({ scraping: null }), HIDE_DELAY_MS);
  }
}
