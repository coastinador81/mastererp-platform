import { useLayoutEffect, useRef, useState } from 'react';
import { sleep } from '@/shared/lib';
import { Dialog, Icon, toast } from '@/shared/ui';
import { Model3DService } from '../../api/model3dService';
import { DEFAULT_GENERATOR_CONFIG } from '../../model/constants';
import { fileNameOf } from '../../model/format';
import { buildGeneratedModel, GENERATION_STEPS, serverModelData, stepDelay } from '../../model/generation';
import { galleryImages, type ImageSets } from '../../model/images';
import { endGenerationRun, startGenerationRun } from '../../model/pageState';
import type { GeneratorConfig, Model3DFile, ModelData } from '../../model/types';
import type { GeneratorRequest } from '../../hooks/useModelActions';
import type { Model3DStore } from '../../hooks/useModel3D';
import { useMounted } from '../../hooks/useMounted';
import { GeneratorSettings } from './GeneratorSettings';
import { GeneratedResults, GenerationRun, ProcessingState } from './GeneratorStatus';
import { SourceThumbs, useSourcePreviews } from './SourceThumbs';

export interface GeneratorDialogProps {
  request: GeneratorRequest;
  imageSets: ImageSets;
  productKey: string;
  store: Pick<Model3DStore, 'get3D' | 'set3D'>;
  onClose: () => void;
  onComplete: (model: ModelData, key?: string | null) => void;
}

/**
 * «Generar Modelo 3D con Uony» (Model3DGenerator del original). La generación es
 * la simulación del original (9 pasos); sigue aunque se cierre el diálogo y la
 * pestaña muestra su progreso. Con un upload_id guardado muestra el
 * procesamiento en el servidor y sus resultados.
 */
export function GeneratorDialog({ request, imageSets, productKey, store, onClose, onComplete }: GeneratorDialogProps) {
  const { imageSource, customImages } = request;
  // Las imágenes y la categoría se fijan al abrir, como el original.
  const [source] = useState(() => galleryImages(imageSets).map(image => ({ id: image.id, url: image.url, name: image.name || 'image' })));
  const [category] = useState(() => store.get3D().model3DCategory);
  const total = imageSource === 'upload' ? customImages.length : source.length;
  const previews = useSourcePreviews(imageSource, customImages, source);
  const [config, setConfig] = useState<GeneratorConfig>(() => ({ ...DEFAULT_GENERATOR_CONFIG }));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [run, setRun] = useState<{ step: string; progress: number } | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(() => store.get3D().uploadId || null);
  const [results, setResults] = useState<Model3DFile[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [isLoadingResults, setLoadingResults] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  // Como el contenido del Dialog de Radix: recibe el foco si el control enfocado desaparece (E43).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body?.isConnected && (!document.activeElement || document.activeElement === document.body)) body.focus({ preventScroll: true });
  });

  const safe = (fn: () => void) => { if (mounted.current) fn(); };

  async function handleGenerate() {
    const images = imageSource === 'upload' ? customImages : source;
    if (images.length === 0) {
      toast.error('❌ No hay imágenes fuente disponibles');
      return;
    }
    setRun({ step: '', progress: 0 });
    const generation = startGenerationRun(productKey);
    try {
      // Simulación del original: pasos animados.
      for (const { progress, step } of GENERATION_STEPS) {
        if (generation.cancelled) return;
        safe(() => setRun({ step, progress }));
        store.set3D({ isGenerating3D: true, generation3DProgress: progress });
        await sleep(stepDelay());
      }
      if (generation.cancelled) return;
      const model = buildGeneratedModel(config, category);
      const { triangles } = model.validationData;
      toast.success('✅ ¡Modelo 3D generado con éxito!', {
        description: `${triangles.toLocaleString()} triángulos • Texturas ${config.textureResolution}px`,
      });
      onComplete(model);
    } catch (error) {
      toast.error('❌ Error al generar el modelo 3D', { description: error instanceof Error && error.message ? error.message : 'Intenta nuevamente' });
      safe(() => setRun(null));
      store.set3D({ isGenerating3D: false, generation3DProgress: 0 });
    } finally {
      endGenerationRun(productKey, generation);
    }
  }

  async function handleCheckResults() {
    if (!uploadId) return;
    setLoadingResults(true);
    try {
      const files = await Model3DService.listModelsByUploadId(uploadId);
      if (files.length === 0) {
        toast.info('⏳ Aún procesando', { description: 'El modelo 3D aún se está generando. Intenta en unos minutos.', duration: 5000 });
      } else {
        safe(() => setResults(files));
        toast.success(`✅ ${files.length} archivo(s) generado(s)`);
      }
    } catch (error) {
      toast.error('Error al consultar resultados', { description: error instanceof Error ? error.message : undefined });
    } finally {
      safe(() => setLoadingResults(false));
    }
  }

  const cancelProcessing = () => {
    store.set3D({ uploadId: null });
    setUploadId(null);
    setResults([]);
    toast.info('Procesamiento cancelado');
  };

  const pick = (file: Model3DFile) => {
    setPicked(file.key);
    toast.info('✅ Imagen seleccionada - Cierra el modal para ver el visor');
  };

  const applySelected = () => {
    const file = results.find(item => item.key === picked);
    if (!file) return;
    onComplete(serverModelData(file, fileNameOf(file.key)), file.key);
    onClose();
  };

  const isGenerating = run !== null;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      className="pim-modelos3d-dialog"
      title={<><span className="pim-modelos3d-dlg-icon is-ai"><Icon name="uony" size={18} /></span>Generar Modelo 3D con Uony</>}
      description={`Genera un modelo 3D desde ${total} ${total === 1 ? 'imagen' : 'imágenes'} (${imageSource === 'upload' ? 'subida' : 'de galería'})`}
    >
      <div className="pim-modelos3d-dlg" tabIndex={-1} ref={bodyRef}>
        <p className="pim-sr-only">Genera un modelo 3D automáticamente desde las imágenes del producto usando inteligencia artificial</p>
        {uploadId && !isGenerating ? (
          <div className="pim-modelos3d-dlg-end">
            <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" onClick={cancelProcessing}>
              <Icon name="x" size={14} /> Cancelar
            </button>
          </div>
        ) : null}
        {!uploadId ? <SourceThumbs label={imageSource === 'upload' ? 'Subidas' : 'Galería'} previews={previews} total={total} /> : null}
        {!isGenerating && !uploadId ? (
          <GeneratorSettings
            config={config}
            showAdvanced={showAdvanced}
            onConfig={patch => setConfig(current => ({ ...current, ...patch }))}
            onAdvanced={() => setShowAdvanced(open => !open)}
            onGenerate={() => void handleGenerate()}
          />
        ) : null}
        {uploadId && !isGenerating && results.length === 0 ? (
          <ProcessingState uploadId={uploadId} isLoading={isLoadingResults} onCheck={() => void handleCheckResults()} />
        ) : null}
        {results.length > 0 ? <GeneratedResults files={results} selected={picked} onPick={pick} onUse={applySelected} /> : null}
        {run ? <GenerationRun step={run.step} progress={run.progress} config={config} /> : null}
      </div>
    </Dialog>
  );
}
