import { useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { setUi, useUiStore } from '../hooks/uiStore';

/**
 * Centro de la cabecera del espacio para el servicio abierto (en el PROTO,
 * `#topbar-center`, donde Producto pinta los canales de venta). El servicio lo
 * rellena con un portal; mientras nadie lo usa, el hueco queda oculto.
 *
 *   <TopbarCenter><div className="channel-bar" role="group" …>…</div></TopbarCenter>
 */
export function TopbarCenter({ children }: { children: ReactNode }) {
  const node = useUiStore(state => state.topbarCenterNode);
  useLayoutEffect(() => {
    setUi(state => ({ topbarCenterCount: state.topbarCenterCount + 1 }));
    return () => setUi(state => ({ topbarCenterCount: Math.max(0, state.topbarCenterCount - 1) }));
  }, []);
  return node ? createPortal(children, node) : null;
}
