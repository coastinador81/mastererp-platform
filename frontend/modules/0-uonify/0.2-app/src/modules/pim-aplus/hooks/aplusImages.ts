import { aplusApi, errorBody } from '../api/aplusApi';

/**
 * downloadAplusImage (APlusContentInterface.tsx 212-241): descarga por image-proxy
 * las imágenes de Amazon y las guarda (data:) mientras la pestaña está montada.
 */
export interface ImageDownloads {
  download(uploadDestinationId: string | undefined): Promise<string | null>;
  clear(): void;
}

export function createImageDownloads(): ImageDownloads {
  const cache = new Map<string, string | null>();
  return {
    async download(uploadDestId) {
      if (!uploadDestId || String(uploadDestId).includes('dummy')) return null;
      if (cache.has(uploadDestId)) return cache.get(uploadDestId) || null;
      try {
        const response = await aplusApi.getAplusImage({ uploadDestinationId: uploadDestId });
        const imageData = response?.body || response;
        if (imageData?.image && imageData?.contentType) {
          const dataUrl = `data:${imageData.contentType};base64,${imageData.image}`;
          cache.set(uploadDestId, dataUrl);
          return dataUrl;
        }
        return null;
      } catch (error) {
        if (errorBody(error).error === 'IMAGE_NOT_ACCESSIBLE') {
          console.info(`Imagen no accesible: ${uploadDestId} - Borrador A+ (publicar para ver imágenes)`);
        }
        return null;
      }
    },
    clear() {
      cache.clear();
    },
  };
}
