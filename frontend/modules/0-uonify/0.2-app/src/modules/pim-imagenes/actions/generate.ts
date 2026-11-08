import type { PimProduct, PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { generateImages } from '../api/imagesApi';
import { MESSAGES } from '../model/labels';
import type { ImageItem } from '../model/types';
import { imagesMemory, session } from '../state/memory';
import { mutate } from './gallery';

/**
 * «Generar Imágenes» (prototipo: handleGenerateAIImages). Uony genera tres
 * imágenes con el estilo predeterminado (profesional, alta calidad, 1:1, luz
 * natural); van a «Imágenes IA Generadas» del producto que las pidió.
 */
export async function handleGenerateAIImages(scope: PimScope, product: PimProduct | null): Promise<void> {
  if (!product) {
    toast.error(MESSAGES.selectProduct);
    return;
  }
  if (imagesMemory.getState().isGeneratingAI) return;
  const aiStyleConfig = { ...session.aiStyleConfig };
  const selectedProductData = { ...product, id: product.id ?? scope.key };
  imagesMemory.setState({ isGeneratingAI: true });
  try {
    const name = typeof selectedProductData.name === 'string' && selectedProductData.name ? selectedProductData.name : 'Producto';
    const result = await generateImages(name, selectedProductData, aiStyleConfig, 3);
    const images = result?.success && Array.isArray(result.images) ? result.images : [];
    if (!images.length) throw new Error(result?.error || 'No se generaron imágenes');
    const stamp = Date.now();
    const aiGeneratedResults: ImageItem[] = images.map((img, index) => ({
      id: img.id || `ai-${stamp}-${index}`,
      url: img.url,
      name: img.name,
      size: img.size,
      type: img.type,
      source: 'ai-generated',
      status: 'generated',
      style: img.style,
      prompt: img.prompt,
      dimensions: img.dimensions,
      styleConfig: img.styleConfig,
    }));
    mutate(scope, lists => {
      lists.ai = [...lists.ai, ...aiGeneratedResults];
    });
    toast.success(MESSAGES.generated(images.length, aiStyleConfig.style));
  } catch (error) {
    toast.error(MESSAGES.error((error instanceof Error && error.message) || MESSAGES.generateFallback));
  } finally {
    imagesMemory.setState({ isGeneratingAI: false });
  }
}
