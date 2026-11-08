import { useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import clsx from 'clsx';
import { Dialog, Icon, toast } from '@/shared/ui';
import { Model3DService } from '../../api/model3dService';
import { trackBlobURL } from '../../model/pageState';
import { analysisResult, modelFormat, validateModelFile } from '../../model/uploader';
import type { ModelData, ValidationData } from '../../model/types';
import type { Model3DStore } from '../../hooks/useModel3D';
import { ModelNotes } from '../ModelNotes';
import { UploaderAlerts, UploaderContent, type ValidationStatus } from './UploaderContent';

export interface UploaderDialogProps {
  productKey: string;
  store: Pick<Model3DStore, 'get3D' | 'set3D'>;
  onClose: () => void;
  onComplete: (model: ModelData) => void;
}

/** Análisis simulado del original: +10 % cada 150 ms y el resultado al llegar al 100 %. */
function analyzeModel(onProgress: (progress: number) => void): Promise<ValidationData> {
  return new Promise(resolve => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      onProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        resolve(analysisResult());
      }
    }, 150);
  });
}

const NOTES = [
  { icon: 'm3d-circle-check', title: 'Optimización Automática', text: 'Validamos geometría, texturas y alineación' },
  { icon: 'layers', title: 'Compatibilidad AR', text: 'Verificamos compatibilidad con realidad aumentada y extensiones glTF' },
];

/**
 * «Cargar Modelo 3D» (Model3DUploader del original, E46/E47): valida y analiza
 * el archivo, lo sube a POST /img-3d/upload con el upload_id del producto y
 * guarda el devuelto; el visor abre el archivo local.
 */
export function UploaderDialog({ productKey, store, onClose, onComplete }: UploaderDialogProps) {
  const [isDragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setProcessing] = useState(false);
  const [data, setData] = useState<ValidationData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [focusTarget, setFocusTarget] = useState<'pick' | 'retry' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // El foco estaba en un botón que desapareció: pasa al equivalente.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!focusTarget || !body) return;
    const target = body.querySelector<HTMLElement>(`[data-u="${focusTarget}"]`);
    if (focusTarget === 'pick' || !body.contains(document.activeElement)) target?.focus({ preventScroll: true });
  }, [focusTarget, status, isProcessing]);

  async function processFile(next: File) {
    setFile(next);
    setProcessing(true);
    setStatus('validating');
    setProgress(0);
    setFocusTarget(null);
    try {
      const validation = validateModelFile(next);
      if (!validation.isValid) {
        setStatus('error');
        toast.error(`❌ ${validation.error}`);
        return;
      }
      const analysis = await analyzeModel(setProgress);
      setData(analysis);
      if (analysis.errors.length > 0) {
        setStatus('error');
        toast.error('❌ El modelo tiene errores críticos', { description: analysis.errors[0] });
        return;
      }
      setStatus('success');
      // Subir modelo al backend (con el upload_id del producto, y se guarda el devuelto).
      const result = await Model3DService.upload3DModel(next, store.get3D().uploadId || undefined);
      if (result.upload_id && productKey) store.set3D({ uploadId: result.upload_id });
      const url = trackBlobURL(URL.createObjectURL(next));
      toast.success('✅ Modelo subido y validado exitosamente', {
        description: `Score: ${analysis.validationScore}% • ${analysis.triangles.toLocaleString()} triángulos`,
      });
      onComplete({ url, name: next.name, size: next.size, format: modelFormat(next.name), validationData: analysis });
    } catch (error) {
      setStatus('error');
      toast.error(`❌ Error: ${error instanceof Error && error.message ? error.message : 'Error al procesar el modelo'}`);
    } finally {
      setProcessing(false);
      setFocusTarget('retry');
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (dropped.length > 0) void processFile(dropped[0]);
  };
  const retry = () => {
    setStatus('idle');
    setFile(null);
    setData(null);
    setFocusTarget('pick');
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      className="pim-modelos3d-dialog"
      title={<><span className="pim-modelos3d-dlg-icon"><Icon name="upload" size={18} /></span>Cargar Modelo 3D</>}
      description="Sube archivos GLB o glTF con texturas PBR"
    >
      <div className="pim-modelos3d-dlg" ref={bodyRef}>
        <p className="pim-sr-only">Sube archivos GLB o glTF para agregar modelos 3D a tu producto</p>
        <div
          className={clsx(
            'pim-dropzone pim-modelos3d-drop',
            isDragging && 'is-dragging',
            !isDragging && status === 'error' && 'is-error',
            !isDragging && status === 'success' && 'is-success',
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".glb,.gltf"
            hidden
            aria-label="Seleccionar Archivo"
            onChange={event => {
              const picked = event.target.files?.[0];
              if (picked) void processFile(picked);
              event.target.value = '';
            }}
          />
          <div aria-live="polite">
            <UploaderContent
              status={status}
              isProcessing={isProcessing}
              progress={progress}
              fileName={file?.name ?? ''}
              data={data}
              onPick={() => inputRef.current?.click()}
              onRetry={retry}
            />
          </div>
        </div>
        <div className="pim-modelos3d-dlg-stack is-tight"><UploaderAlerts data={data} /></div>
        <ModelNotes items={NOTES} />
      </div>
    </Dialog>
  );
}
