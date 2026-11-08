import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { setUi, useUiStore, workspaceRefs } from '../hooks/uiStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { chatWidthLimits, clampChatWidth, sashKeyWidth } from '../model/chatPanel';

/**
 * Borde redimensionable del panel de conversación (role="separator"): con el
 * ratón o con las flechas, entre 360 y 640 px; doble clic lo restablece y el
 * ancho se guarda en la sesión. Solo actúa con el panel a la derecha.
 */
export function ChatSash({ active }: { active: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [measured, setMeasured] = useState(0);
  const sash = useRef<HTMLDivElement>(null);
  const width = useWorkspaceStore(state => state.chatPanelWidth);
  const dragWidth = useUiStore(state => state.chatDragWidth);
  const columnWidth = workspaceRefs.column?.clientWidth ?? 0;
  const { min, max } = chatWidthLimits(columnWidth);

  // Anchura real del panel para aria-valuenow (el valor por defecto es un clamp de CSS).
  useEffect(() => {
    const dock = sash.current?.closest('.conversation-dock');
    if (!dock || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setMeasured(Math.round(dock.getBoundingClientRect().width)));
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !active) return;
    event.preventDefault();
    const sash = event.currentTarget;
    sash.setPointerCapture?.(event.pointerId);
    setDragging(true);
    const right = workspaceRefs.column?.getBoundingClientRect().right ?? window.innerWidth;
    const total = workspaceRefs.column?.clientWidth ?? 0;
    const move = (moveEvent: globalThis.PointerEvent) => setUi({ chatDragWidth: clampChatWidth(right - moveEvent.clientX, total) });
    const stop = () => {
      setDragging(false);
      sash.removeEventListener('pointermove', move);
      const final = useUiStore.getState().chatDragWidth;
      if (final !== null) useWorkspaceStore.getState().setChatPanelWidth(final);
      setUi({ chatDragWidth: null });
    };
    sash.addEventListener('pointermove', move);
    sash.addEventListener('pointerup', stop, { once: true });
    sash.addEventListener('pointercancel', stop, { once: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    const current = event.currentTarget.closest('.conversation-dock')?.getBoundingClientRect().width ?? 0;
    const total = workspaceRefs.column?.clientWidth ?? 0;
    const next = sashKeyWidth(event.key, current, total);
    if (next === undefined) return;
    event.preventDefault();
    useWorkspaceStore.getState().setChatPanelWidth(clampChatWidth(next, total));
  };

  return (
    <div
      ref={sash}
      className={`chat-panel-sash${dragging ? ' is-dragging' : ''}`}
      id="chat-panel-sash"
      role="separator"
      aria-orientation="vertical"
      aria-controls="conversation-dock"
      aria-label="Ancho de la conversación"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={dragWidth ?? width ?? measured}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useWorkspaceStore.getState().setChatPanelWidth(null)}
      onKeyDown={onKeyDown}
    />
  );
}
