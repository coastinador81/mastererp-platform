import clsx from 'clsx';
import { Icon } from '@/shared/ui';

/**
 * Varita de Uony, solo icono con tooltip (= su aria-label). En las cabeceras de
 * sección es pim-btn-ai; en las seis filas de viñetas, fantasma con el icono en
 * el color de la IA. Mientras genera: deshabilitada, ocupada y con spinner.
 */
export function WandButton({ field, label, row = false, busy, onGenerate }: {
  field: string;
  label: string;
  row?: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx('pim-btn', row ? 'pim-btn-ghost pim-descripciones-wand-row' : 'pim-btn-ai', 'pim-btn-icon pim-descripciones-wand')}
      data-generate={field}
      aria-label={label}
      data-tooltip={label}
      data-tooltip-align="end"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onGenerate}
    >
      {busy ? <Icon name="loader" size={16} className="pim-spin" /> : <Icon name="uony" size={16} />}
    </button>
  );
}
