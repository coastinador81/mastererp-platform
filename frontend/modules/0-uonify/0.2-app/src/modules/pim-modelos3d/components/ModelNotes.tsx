import type { ReactNode } from 'react';
import { InformationDisclosure } from '@/shared/ui';

export interface ModelNote {
  icon: string;
  title: string;
  text: ReactNode;
}

/** Notas informativas: texto pequeño y apagado con su icono, sin tarjetas. */
export function ModelNotes({ items }: { items: ModelNote[] }) {
  return (
    <div className="pim-modelos3d-notes">
      {items.map(item => (
        <InformationDisclosure label={item.title} key={item.title}><p>{item.text}</p></InformationDisclosure>
      ))}
    </div>
  );
}
