import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/shared/ui';
import { Model3DService } from '../api/model3dService';
import { CLEAR_SELECTION, isFileSelected, ownFiles } from '../model/state';
import type { Model3DFile } from '../model/types';
import type { Model3DStore } from './useModel3D';

export interface ModelFilesApi {
  /** «Imágenes Generadas»: modelos del producto + los del servidor. */
  files: Model3DFile[];
  isLoading: boolean;
  refresh: () => void;
  deleteAll: () => Promise<void>;
  selectFile: (file: Model3DFile) => void;
  deleteFile: (file: Model3DFile) => Promise<void>;
}

/**
 * Lista de modelos de la pestaña (Models3DTab del original). Estado local: se
 * pierde al salir de la pestaña, como en el original. Al montar carga los del
 * servidor si hay un upload_id guardado.
 */
export function useModelFiles(productKey: string, { get3D, set3D }: Pick<Model3DStore, 'get3D' | 'set3D'>): ModelFilesApi {
  const [files, setFiles] = useState<Model3DFile[]>(() => ownFiles(get3D()));
  // Al montar ya carga si hay un upload_id guardado.
  const [isLoading, setLoading] = useState(() => !!(productKey && get3D().uploadId));
  const mounted = useRef(false);

  // Lista recibida: modelos del producto + del servidor; abre el primero si no hay ninguno.
  const apply = useCallback((list: Model3DFile[]) => {
    setFiles([...ownFiles(get3D()), ...list]);
    if (list.length > 0 && !get3D().selected3DModel) {
      set3D({ selected3DModel: list[0].url, selectedKey: list[0].key });
      toast.success('Modelo 3D cargado automáticamente');
    }
    setLoading(false);
  }, [get3D, set3D]);

  useEffect(() => {
    mounted.current = true;
    const uploadId = get3D().uploadId;
    if (productKey && uploadId) {
      void Model3DService.listModelsByUploadId(uploadId).then(list => { if (mounted.current) apply(list); });
    }
    return () => { mounted.current = false; };
    // Solo al montar (useEffect de Models3DTab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    if (!productKey) return;
    const uploadId = get3D().uploadId;
    if (!uploadId) return;
    setLoading(true);
    void Model3DService.listModelsByUploadId(uploadId).then(list => { if (mounted.current) apply(list); });
  }, [productKey, get3D, apply]);

  const deleteAll = useCallback(async () => {
    if (!productKey) return;
    const uploadId = get3D().uploadId;
    if (!uploadId) {
      if (!ownFiles(get3D()).length) return;
      setFiles([]);
      set3D({ files: [], ...CLEAR_SELECTION });
      toast.success('Todos los modelos eliminados');
      return;
    }
    try {
      await Model3DService.deleteAllModels(uploadId);
      setFiles([]);
      set3D({ files: [], ...CLEAR_SELECTION, uploadId: null });
      toast.success('Todos los modelos eliminados');
    } catch {
      toast.error('Error al eliminar modelos');
    }
  }, [productKey, get3D, set3D]);

  const selectFile = useCallback((file: Model3DFile) => {
    set3D({ selected3DModel: file.url, selectedKey: file.key });
    toast.success('Modelo 3D cargado');
  }, [set3D]);

  const deleteFile = useCallback(async (file: Model3DFile) => {
    try {
      if (file.local) set3D({ files: ownFiles(get3D()).filter(item => item.key !== file.key) });
      else await Model3DService.deleteModel(file.key);
      setFiles(list => list.filter(item => item.key !== file.key));
      if (isFileSelected(file, get3D())) set3D(CLEAR_SELECTION);
      toast.success('Modelo eliminado');
    } catch {
      toast.error('Error al eliminar modelo');
    }
  }, [get3D, set3D]);

  return { files, isLoading, refresh, deleteAll, selectFile, deleteFile };
}
