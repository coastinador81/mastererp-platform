import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand } from 'lucide-react';
import { Dialog } from '@/shared/ui';

export type InterfaceView = 'producto-atributos' | 'producto-descripciones' | 'producto-imagenes' | 'espacio-inicio' | 'uony-conectar' | 'uony-archivos' | 'uony-revision';
const TITLES: Record<InterfaceView, string> = {
  'producto-atributos': 'Producto · Atributos', 'producto-descripciones': 'Producto · Descripciones',
  'producto-imagenes': 'Producto · Imágenes', 'espacio-inicio': 'Tu espacio con Uony',
  'uony-conectar': 'Uony · Conectar Amazon', 'uony-archivos': 'Uony · Archivos del producto',
  'uony-revision': 'Uony · Revisar antes de publicar',
};

/** Captura sin retoques del frontend actual. No recrea controles ni accede a la sesión. */
export function InterfaceCapture({ view, className = '' }: { view: InterfaceView; className?: string }) {
  const [open, setOpen] = useState(false);
  const title = TITLES[view];
  const src = `/assets/interface/${view}.png`;
  return <div className={`interface-capture ${className}`} data-interface-view={view}>
    <button type="button" className="product-capture-image" aria-label={`Ampliar ${title}`} onClick={() => setOpen(true)}>
      <img src={src} alt={`Interfaz actual de Uonify: ${title}`} width="1760" height={view.startsWith('producto-') ? 767 : 823} loading="lazy" />
    </button>
    <button type="button" className="interface-capture-expand" onClick={() => setOpen(true)}><Expand size={14} aria-hidden="true" />Ampliar {title}</button>
    {open && createPortal(<Dialog open onClose={() => setOpen(false)} title={title} size="xl" className="product-capture-dialog">
      <img className="product-capture-full" src={src} alt={`Interfaz actual de Uonify: ${title}`} width="1760" height={view.startsWith('producto-') ? 767 : 823} />
      <a className="product-capture-original" href={src} target="_blank" rel="noreferrer">Abrir imagen a tamaño completo ↗</a>
    </Dialog>, document.body)}
  </div>;
}
