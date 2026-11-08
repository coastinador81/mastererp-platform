import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { getTopDialogLayer, subscribeDialogLayers } from '../dialog/dialogLayer';
import { getToasts, subscribeToasts, toast, type ToastItem, type ToastType } from './toastStore';

/**
 * Región de avisos (prototipo: <section class="pim-toaster" aria-label="Notificaciones">).
 * Se monta una vez en AppProviders.
 */
const TOAST_ICONS: Partial<Record<ToastType, IconName>> = {
  success: 'check-circle',
  error: 'x-circle',
  warning: 'alert-triangle',
  info: 'info',
  loading: 'loader',
};

function ToastView({ item }: { item: ToastItem }) {
  const icon = TOAST_ICONS[item.type];
  return (
    <div className={`pim-toast pim-toast-${item.type}`} role={item.type === 'error' ? 'alert' : 'status'} data-toast-id={item.id}>
      {icon ? <Icon name={icon} size={18} className={item.type === 'loading' ? 'pim-spin' : undefined} /> : null}
      <div className="pim-toast-body">
        <strong>{item.message}</strong>
        {item.description ? <span>{item.description}</span> : null}
      </div>
      <button type="button" className="pim-toast-close" aria-label="Cerrar notificación" onClick={() => toast.dismiss(item.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

const serverLayer = () => null;

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const layer = useSyncExternalStore(subscribeDialogLayers, getTopDialogLayer, serverLayer);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section className="pim-toaster" aria-label="Notificaciones">
      {items.map(item => <ToastView key={item.id} item={item} />)}
    </section>,
    layer ?? document.body,
  );
}
