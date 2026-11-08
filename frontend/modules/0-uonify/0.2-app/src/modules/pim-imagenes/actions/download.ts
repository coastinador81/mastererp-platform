import { download } from '@/shared/lib';
import { toast } from '@/shared/ui';
import { fetchImageBlob } from '../api/imagesApi';
import { MESSAGES } from '../model/labels';
import type { ImageItem } from '../model/types';

/**
 * «Descargar» y «Favorito» (prototipo: handleDownloadImage; el corazón también
 * descarga). Las blob: se guardan tal cual; las demás se piden como Blob.
 */
export async function handleDownloadImage(image: ImageItem): Promise<void> {
  const filename = image.name || 'image.jpg';
  try {
    const url = String(image.url || '');
    if (url.startsWith('blob:')) {
      download(url, filename);
      toast.success(MESSAGES.downloaded(filename));
      return;
    }
    const blob = await fetchImageBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    download(objectUrl, filename);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    toast.success(MESSAGES.downloaded(filename));
  } catch {
    toast.error(MESSAGES.downloadError);
  }
}
