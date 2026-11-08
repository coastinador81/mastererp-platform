import { useCallback, useState } from 'react';
import { download } from '@/shared/lib';
import type { PimProduct } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { GENERATED_MODEL } from '../model/constants';
import { qualityFrom } from '../model/generation';
import { galleryImages, type ImageSets } from '../model/images';
import { cancelGenerationRun } from '../model/pageState';
import { CLEAR_SELECTION } from '../model/state';
import type { ImageSource, ModelData } from '../model/types';
import type { Model3DStore } from './useModel3D';

/** Lo que recibe el Generador al abrirse (fuente elegida y archivos subidos). */
export interface GeneratorRequest {
  imageSource: ImageSource;
  customImages: File[];
}

export interface ModelActions {
  generator: GeneratorRequest | null;
  uploaderOpen: boolean;
  /** Modelo de la Vista AR abierta, o null. */
  arModel: string | null;
  closeGenerator: () => void;
  closeUploader: () => void;
  closeAR: () => void;
  generate: (imageSource: ImageSource, customImages: File[]) => void;
  upload: () => void;
  downloadModel: () => Promise<void>;
  activateAR: () => void;
  deleteModel: () => void;
  cancelGeneration: () => void;
  completeGeneration: (model: ModelData, key?: string | null) => void;
  completeUpload: (model: ModelData) => void;
}

/**
 * Manejadores 3D de la ficha (ProductsPIMInterface del original:
 * handleGenerate3DModel, handleGenerationComplete, handleUpload3DModel,
 * handleUploadComplete, handleDownload3DModel, handleActivateAR,
 * handleDelete3DModel y onCancelGeneration) y los diálogos que abren.
 */
export function useModelActions(
  productKey: string,
  product: PimProduct | null,
  { get3D, set3D }: Pick<Model3DStore, 'get3D' | 'set3D'>,
  imageSets: ImageSets,
): ModelActions {
  const [generator, setGenerator] = useState<GeneratorRequest | null>(null);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [arModel, setArModel] = useState<string | null>(null);

  const generate = useCallback((imageSource: ImageSource, customImages: File[]) => {
    const imagesToUse = imageSource === 'upload' ? customImages : galleryImages(imageSets);
    if (!productKey || imagesToUse.length === 0) {
      toast.error('❌ Necesitas al menos una imagen para generar un modelo 3D');
      return;
    }
    setGenerator({ imageSource, customImages: [...customImages] });
  }, [productKey, imageSets]);

  const completeGeneration = useCallback((model: ModelData, key: string | null = null) => {
    set3D({
      selected3DModel: model.url || null,
      selectedKey: key,
      modelQualityInfo: qualityFrom(model),
      isGenerating3D: false,
      generation3DProgress: 0,
    });
    setGenerator(null);
    toast.success('✅ Modelo 3D generado correctamente');
  }, [set3D]);

  const completeUpload = useCallback((model: ModelData) => {
    set3D({ selected3DModel: model.url, selectedKey: null, modelQualityInfo: qualityFrom(model) });
    setUploaderOpen(false);
  }, [set3D]);

  const downloadModel = useCallback(async () => {
    const selected = get3D().selected3DModel;
    if (!selected) {
      toast.error('❌ No hay modelo disponible para descargar');
      return;
    }
    try {
      toast.info('📥 Descargando modelo 3D...');
      const source = selected === GENERATED_MODEL ? await (await import('../three')).generatedModelURL() : selected;
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      download(url, `${product?.name || 'modelo'}-3d-${Date.now()}.glb`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('✅ Modelo 3D descargado', { description: 'Formato: GLB con texturas PBR' });
    } catch {
      toast.error('❌ Error al descargar modelo');
    }
  }, [get3D, product]);

  const activateAR = useCallback(() => {
    const selected = get3D().selected3DModel;
    if (!selected) {
      toast.error('❌ No hay modelo disponible para AR');
      return;
    }
    setArModel(selected);
    toast.success('🚀 Abriendo Vista AR', { description: 'Preparando experiencia de realidad aumentada' });
  }, [get3D]);

  const deleteModel = useCallback(() => {
    set3D(CLEAR_SELECTION);
    toast.success('🗑️ Modelo 3D eliminado');
  }, [set3D]);

  const cancelGeneration = useCallback(() => {
    cancelGenerationRun(productKey);
    set3D({ isGenerating3D: false, generation3DProgress: 0 });
    toast.info('❌ Generación 3D cancelada');
  }, [productKey, set3D]);

  return {
    generator,
    uploaderOpen,
    arModel,
    closeGenerator: useCallback(() => setGenerator(null), []),
    closeUploader: useCallback(() => setUploaderOpen(false), []),
    closeAR: useCallback(() => setArModel(null), []),
    generate,
    // Sin archivo abre el modal «Cargar Modelo 3D» (E28).
    upload: useCallback(() => setUploaderOpen(true), []),
    downloadModel,
    activateAR,
    deleteModel,
    cancelGeneration,
    completeGeneration,
    completeUpload,
  };
}
