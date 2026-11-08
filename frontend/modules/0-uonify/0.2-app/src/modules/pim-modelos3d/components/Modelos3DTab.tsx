import { useState } from 'react';
import { USE_MOCKS } from '@/shared/api/config';
import { useTabContext } from '@/shared/pim';
import { useImageSets } from '../hooks/useImageSets';
import { useModel3D } from '../hooks/useModel3D';
import { useModelActions } from '../hooks/useModelActions';
import { useModelFiles } from '../hooks/useModelFiles';
import { useFocusHandoff } from '../hooks/useFocusHandoff';
import { showsModelBlock } from '../model/state';
import type { ImageSource } from '../model/types';
import { ARViewerDialog } from './ar/ARViewerDialog';
import { EmptyState } from './EmptyState';
import { GeneratorDialog } from './generator/GeneratorDialog';
import { ModelBlock } from './ModelBlock';
import { ModelFileList } from './ModelFileList';
import { TabFooter } from './TabFooter';
import { UploaderDialog } from './uploader/UploaderDialog';
import { LiveModelos3DTab } from './LiveModelos3DTab';

export function Modelos3DTab() {
  return USE_MOCKS ? <DemoModelos3DTab /> : <LiveModelos3DTab />;
}

/**
 * Pestaña «3D» de la ficha de producto (prototipo: pim/modelos3d.js, mount;
 * Models3DTab del original). Anatomía: cabecera → (lista de modelos) → modelo
 * o estado vacío → notas → Generación con IA.
 */
function DemoModelos3DTab() {
  const ctx = useTabContext();
  const store = useModel3D();
  const { state } = store;
  const imageSets = useImageSets();
  const modelFiles = useModelFiles(ctx.key, store);
  const actions = useModelActions(ctx.key, ctx.product, store, imageSets);
  const [imageSource, setImageSource] = useState<ImageSource>('gallery');
  const [customImages, setCustomImages] = useState<File[]>([]);
  const mode = showsModelBlock(state, modelFiles.files.length) ? 'block' : 'empty';
  const { ref: focusRef, onFocus, onBlur } = useFocusHandoff(mode);
  const productName = ctx.isNew ? 'Nuevo producto' : (ctx.product?.name || 'Producto Seleccionado');

  return (
    <div className="pim-tab pim-modelos3d-root">
      <header className="pim-head">
        <div className="pim-modelos3d-headrow">
          <h2>Modelos 3D</h2>
          <span className="pim-badge pim-modelos3d-count">{state.selected3DModel ? '1 modelo' : '0 modelos'}</span>
        </div>
      </header>
      {modelFiles.files.length > 0 ? <ModelFileList state={state} {...modelFiles} /> : null}
      <div ref={focusRef} onFocus={onFocus} onBlur={onBlur}>
        {mode === 'block' ? (
          <ModelBlock
            state={state}
            files={modelFiles.files}
            onQualityInfo={info => store.set3D({ modelQualityInfo: info })}
            onDownload={() => void actions.downloadModel()}
            onAR={actions.activateAR}
            onDelete={actions.deleteModel}
            onCancelGeneration={actions.cancelGeneration}
          />
        ) : (
          <EmptyState
            imageSets={imageSets}
            imageSource={imageSource}
            customImages={customImages}
            onSource={setImageSource}
            onCustomImages={setCustomImages}
            onGenerate={() => actions.generate(imageSource, customImages)}
            onUpload={actions.upload}
          />
        )}
      </div>
      <TabFooter />
      {actions.generator ? (
        <GeneratorDialog
          request={actions.generator}
          imageSets={imageSets}
          productKey={ctx.key}
          store={store}
          onClose={actions.closeGenerator}
          onComplete={actions.completeGeneration}
        />
      ) : null}
      {actions.uploaderOpen ? (
        <UploaderDialog productKey={ctx.key} store={store} onClose={actions.closeUploader} onComplete={actions.completeUpload} />
      ) : null}
      {actions.arModel ? <ARViewerDialog modelUrl={actions.arModel} productName={productName} onClose={actions.closeAR} /> : null}
    </div>
  );
}
