import { Icon } from '@/shared/ui';

/** «Generar con Uony» junto a la etiqueta del título (acción de Uony: pim-btn-ai a la altura de la etiqueta). */
export function TitleAiButton({ generating, onClick }: { generating: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="pim-btn pim-btn-ai pim-btn-sm pim-atributos-ai"
      data-action="generate-title"
      disabled={generating}
      aria-busy={generating || undefined}
      onClick={onClick}
    >
      <Icon name="uony" size={14} className={generating ? 'pim-spin' : undefined} />
      <span>{generating ? 'Generando...' : 'Generar con Uony'}</span>
    </button>
  );
}
