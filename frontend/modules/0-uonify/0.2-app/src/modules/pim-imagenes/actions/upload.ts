import { readFileAsDataURL } from '@/shared/lib';
import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { validateImageFile } from '../model/files';
import { MESSAGES } from '../model/labels';
import type { ImageItem } from '../model/types';
import { mutate } from './gallery';

/**
 * «Subir Imágenes» (prototipo: processUploadedFiles). Subida local: FileReader →
 * data URL; nada va al servidor en este paso. Como el original, los archivos no
 * válidos se descartan sin aviso.
 */
export async function processUploadedFiles(scope: PimScope, files: File[]): Promise<void> {
  const valid = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => validateImageFile(file).isValid);
  if (!valid.length) return;
  const stamp = Date.now();
  const read = await Promise.all(valid.map(async ({ file, index }): Promise<ImageItem | null> => {
    try {
      const url = await readFileAsDataURL(file);
      return {
        id: `uploaded-${stamp}-${index}`,
        url,
        name: file.name,
        size: file.size,
        type: file.type,
        source: 'upload',
        status: 'pending',
        originalDimensions: null,
        processedDimensions: null,
      };
    } catch {
      return null;
    }
  }));
  const validFiles = read.filter((item): item is ImageItem => item !== null);
  if (!validFiles.length) return;
  mutate(scope, lists => {
    lists.uploaded = [...lists.uploaded, ...validFiles];
  });
  toast.success(MESSAGES.uploaded(validFiles.length));
}
