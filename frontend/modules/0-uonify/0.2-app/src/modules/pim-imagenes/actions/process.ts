import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { MESSAGES } from '../model/labels';
import { stripFile } from '../model/lists';
import type { ImageItem } from '../model/types';
import { imagesMemory, session, setSelection } from '../state/memory';
import { resizeForAmazon } from './canvas';
import { mutate, snapshotFor } from './gallery';

/**
 * «Redimensionar» (prototipo: processSelectedImages): cada imagen seleccionada a
 * 1500 × 1500 sobre blanco. Los resultados son URLs blob: de esta página (tras
 * recargar se sueltan, como el original).
 */
export async function processSelectedImages(scope: PimScope): Promise<void> {
  const { all, selection } = snapshotFor(scope);
  if (selection.length === 0 || imagesMemory.getState().isProcessingImages) return;
  imagesMemory.setState({ isProcessingImages: true });
  const imagesToProcess = all.filter(image => selection.includes(image.id));
  const timestamp = Date.now();
  try {
    const processed = await Promise.all(imagesToProcess.map(async (img, index): Promise<ImageItem | null> => {
      try {
        const { blob, dimensions, originalDimensions } = await resizeForAmazon(img.url);
        const processedUrl = URL.createObjectURL(blob);
        session.liveBlobs.add(processedUrl);
        return {
          ...stripFile(img),
          id: `processed-${timestamp}-${index}`,
          url: processedUrl,
          name: `Processed ${img.name ?? ''}`,
          status: 'processed',
          dimensions,
          originalDimensions,
        };
      } catch {
        return null;
      }
    }));
    const successfullyProcessed = processed.filter((item): item is ImageItem => item !== null && item.status === 'processed');
    setSelection(scope.key, []);
    mutate(scope, lists => {
      lists.processed = [...lists.processed, ...successfullyProcessed];
    });
    const successCount = successfullyProcessed.length;
    const failedCount = imagesToProcess.length - successCount;
    if (successCount > 0) toast.success(MESSAGES.resized(successCount));
    if (failedCount > 0) toast.error(MESSAGES.failed(failedCount));
  } catch {
    toast.error(MESSAGES.processError);
  } finally {
    imagesMemory.setState({ isProcessingImages: false });
  }
}
