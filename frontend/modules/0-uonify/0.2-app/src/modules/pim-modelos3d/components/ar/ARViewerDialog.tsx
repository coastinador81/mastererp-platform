import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, Icon } from '@/shared/ui';
import { AR_TABS, arMemory, nextARTab, rememberAR } from '../../model/ar';
import { threeContext } from '../../model/threeContext';
import type { ARTab } from '../../model/types';
import { ARCameraPanel } from './ARCameraPanel';
import { ARPreviewPanel } from './ARPreviewPanel';
import { ARQrPanel } from './ARQrPanel';

export interface ARViewerDialogProps {
  modelUrl: string;
  productName: string;
  onClose: () => void;
}

/**
 * Vista AR (ARViewerModal del original): «Código QR», «Cámara AR» y «Preview 3D».
 * E48: como el overlay del original, solo se cierra con la X de la cabecera
 * (sin Escape ni clic en el fondo). Cada panel se construye la primera vez que se abre.
 */
export function ARViewerDialog({ modelUrl, productName, onClose }: ARViewerDialogProps) {
  const [optimized] = useState(() => threeContext.count() > 0);
  const [active, setActive] = useState<ARTab>(() => (AR_TABS.some(tab => tab.id === arMemory.activeTab) ? arMemory.activeTab : 'qr'));
  const [built, setBuilt] = useState<ARTab[]>(() => [active]);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const tabRefs = useRef<Partial<Record<ARTab, HTMLButtonElement | null>>>({});
  const idBase = useId();

  // La X del original se añadía a la cabecera del diálogo (data-dialog-close la cierra).
  const bodyRef = useCallback((element: HTMLDivElement | null) => {
    setHeader(element?.closest('.pim-dialog-panel')?.querySelector<HTMLElement>('.pim-dialog-header') ?? null);
  }, []);

  const select = (id: ARTab, focus: boolean) => {
    rememberAR({ activeTab: id });
    setActive(id);
    setBuilt(list => (list.includes(id) ? list : [...list, id]));
    if (focus) tabRefs.current[id]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextARTab(active, event.key);
    if (!next) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      dismissible={false}
      className="pim-modelos3d-dialog"
      title={<><span className="pim-modelos3d-dlg-icon"><Icon name="scan" size={18} /></span>Vista AR - {productName}</>}
      description={
        <>
          Experiencia de Realidad Aumentada
          {optimized ? (
            <span className="pim-badge pim-badge-amber"><i className="pim-modelos3d-dot is-warning" aria-hidden="true" />Modo Optimizado</span>
          ) : null}
        </>
      }
    >
      <div className="pim-modelos3d-dlg pim-modelos3d-ar" ref={bodyRef}>
        <div className="pim-subtabs pim-modelos3d-artabs" role="tablist" aria-label="Vista AR" onKeyDown={onKeyDown}>
          {AR_TABS.map(tab => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              ref={element => { tabRefs.current[tab.id] = element; }}
              id={`${idBase}-tab-${tab.id}`}
              aria-controls={`${idBase}-panel-${tab.id}`}
              aria-selected={active === tab.id}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => select(tab.id, false)}
            >
              <Icon name={tab.icon} size={16} /> {tab.label}
            </button>
          ))}
        </div>
        {AR_TABS.map(tab => (
          <div
            key={tab.id}
            className="pim-modelos3d-arpanel"
            role="tabpanel"
            id={`${idBase}-panel-${tab.id}`}
            aria-labelledby={`${idBase}-tab-${tab.id}`}
            tabIndex={0}
            hidden={active !== tab.id}
          >
            {built.includes(tab.id) ? (
              tab.id === 'qr' ? <ARQrPanel name={productName} />
                : tab.id === 'camera' ? <ARCameraPanel name={productName} />
                  : <ARPreviewPanel modelUrl={modelUrl} name={productName} />
            ) : null}
          </div>
        ))}
      </div>
      {header
        ? createPortal(
          <button type="button" className="pim-dialog-x" data-dialog-close aria-label="Cerrar"><Icon name="x" size={16} /></button>,
          header,
        )
        : null}
    </Dialog>
  );
}
