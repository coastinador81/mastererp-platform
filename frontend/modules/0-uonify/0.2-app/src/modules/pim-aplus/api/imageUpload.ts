import { MARKETPLACE } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { imageDimensionErrors, imageFileErrors } from '../model/imageRules';
import { bytesToBase64, hexToBase64, md5Hex } from '../model/md5';
import type { AplusImage, ImageDimensions } from '../model/types';
import { aplusApi, errorBody } from './aplusApi';

/**
 * Validación y subida de imágenes A+ (utils/aplusImageUpload.ts del original):
 * reserva un destino en Amazon con el MD5 del archivo y lo sube a S3 a través
 * del backend.
 */
export interface ImageValidation {
  isValid: boolean;
  errors: string[];
  dimensions?: ImageDimensions;
}

/** Medidas reales del archivo (carga la imagen en memoria). */
function readDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise(resolve => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

// utils/aplusImageUpload.ts 31-70
export async function validateAPlusImage(file: File, minWidth: number, minHeight: number): Promise<ImageValidation> {
  const errors = imageFileErrors(file.type, file.size);
  const dimensions = await readDimensions(file);
  if (!dimensions) return { isValid: false, errors: [...errors, 'No se pudo cargar la imagen'] };
  errors.push(...imageDimensionErrors(dimensions, minWidth, minHeight));
  return { isValid: errors.length === 0, errors, dimensions };
}

async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(new Error('Error reading file')));
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsArrayBuffer(file);
  });
}

// utils/aplusImageUpload.ts 76-149
export async function uploadAPlusImage(file: File, minWidth: number, minHeight: number, altText = 'Imagen'): Promise<AplusImage> {
  const validation = await validateAPlusImage(file, minWidth, minHeight);
  if (!validation.isValid) throw new Error(validation.errors.join(', '));

  const bytes = await readBytes(file);
  const md5 = md5Hex(bytes);
  const uploadResponse = await aplusApi.getAplusUploadDestination({
    contentType: file.type,
    contentMD5: md5,
    marketplace_id: MARKETPLACE.id,
    country_code: MARKETPLACE.countryCode,
  });
  const uploadData = uploadResponse?.body || uploadResponse;
  const uploadDestinationId = uploadData?.uploadDestinationId;
  const uploadUrl = uploadData?.url;
  const uploadHeaders = uploadData?.headers || {};
  if (!uploadDestinationId || !uploadUrl) throw new Error('No se recibió upload destination de Amazon');

  const uploaded = await aplusApi.uploadImageToS3({
    uploadUrl,
    fileContent: bytesToBase64(bytes),
    contentType: file.type,
    contentMD5: hexToBase64(md5),
    headers: uploadHeaders,
  });
  if (uploaded?.error) throw new Error(`Error subiendo a S3: ${uploaded.error}`);

  return {
    id: `img-${Date.now()}`,
    url: URL.createObjectURL(file),
    file,
    altText,
    dimensions: validation.dimensions || { width: 0, height: 0 },
    size: file.size,
    format: file.type,
    isValid: true,
    validationErrors: [],
    uploadDestinationId,
  };
}

// utils/aplusImageUpload.ts 154-180
export async function handleImageUploadWithToast(file: File, minWidth: number, minHeight: number, altText = 'Imagen'): Promise<AplusImage> {
  const toastId = toast.loading('Validando imagen...');
  try {
    const image = await uploadAPlusImage(file, minWidth, minHeight, altText);
    toast.success('Imagen subida correctamente', { id: toastId });
    return image;
  } catch (error) {
    console.warn('Error en handleImageUploadWithToast:', error);
    const data = errorBody(error);
    const bodyError = data.body?.error || data.body?.message;
    const message = bodyError || data.error || data.message || (error instanceof Error ? error.message : '') || 'Error al preparar imagen';
    toast.error(message, { id: toastId });
    throw error;
  }
}
