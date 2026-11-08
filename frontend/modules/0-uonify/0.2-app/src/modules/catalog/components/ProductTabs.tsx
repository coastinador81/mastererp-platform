import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/shared/ui';
import { PIM_TAB_LABELS, PIM_TAB_ORDER, type PimTabDefinition, type PimTabKey } from '@/shared/pim';
import { ProductIcon, isProductIconName } from './ProductIcon';

// Iconos del prototipo junto a la etiqueta (solo GPSR, 3D, Vídeo y A+) si el módulo
// de la pestaña aún no ha dado el suyo.
const FALLBACK_ICONS: Partial<Record<PimTabKey, string>> = { gpsr: 'shield', modelos3d: 'package', video: 'video', aplus: 'sparkles' };

function TabIcon({ name }: { name: string | null | undefined }) {
  if (!name) return null;
  return isProductIconName(name) ? <ProductIcon name={name} /> : <Icon name={name} size={14} />;
}

export interface ProductTabsProps {
  definitions: PimTabDefinition[];
  active: PimTabKey;
  onSelect: (tab: PimTabKey, focus: boolean) => void;
  incidentCount?: number;
}

/**
 * Barra de pestañas de la ficha (prototipo: TabsList): flechas, Inicio y Fin
 * recorren las pestañas; en una ficha estrecha la barra se desplaza para que la
 * pestaña abierta siempre esté a la vista.
 */
export function ProductTabs({ definitions, active, onSelect, incidentCount = 0 }: ProductTabsProps) {
  const bar = useRef<HTMLElement>(null);
  // Conserva la pestaña abierta al resolverse la última, hasta que la persona salga.
  const visibleTabs = PIM_TAB_ORDER.filter(key => key !== 'incidencias' || incidentCount > 0 || active === 'incidencias');

  useLayoutEffect(() => {
    const element = bar.current;
    const open = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !open || element.scrollWidth <= element.clientWidth) return;
    const left = open.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
    element.scrollLeft = Math.max(0, left - (element.clientWidth - open.offsetWidth) / 2);
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { key } = event;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const count = visibleTabs.length;
    const next = key === 'Home' ? 0 : key === 'End' ? count - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + count) % count;
    onSelect(visibleTabs[next], true);
  };

  return (
    <nav ref={bar} className="product-editor-tabs" role="tablist" aria-label="Contenido de la ficha" data-source-component="TabsList">
      {visibleTabs.map((key, index) => {
        const definition = definitions.find(item => item.key === key);
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`product-tab-${key}`}
            data-product-tab={key}
            aria-controls="product-tab-panel"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(key, true)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            <TabIcon name={definition ? definition.icon : FALLBACK_ICONS[key]} />
            {definition?.label ?? PIM_TAB_LABELS[key]}
            {key === 'incidencias' && incidentCount > 0 && ` · ${incidentCount}`}
          </button>
        );
      })}
    </nav>
  );
}
