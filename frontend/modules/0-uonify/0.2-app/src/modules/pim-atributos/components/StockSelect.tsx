import clsx from 'clsx';
import { radixSelectKeys } from './selectKeys';

/**
 * Selector de stock (StockSelector.tsx del original). Controlado: enseña el
 * valor guardado hasta que la actualización por EDI termina bien.
 */
export function StockSelect({ id, available, loading, updating, onChange }: {
  id: string;
  available: boolean;
  loading: boolean;
  updating: boolean;
  onChange: (value: string) => void;
}) {
  const tone = loading ? 'is-loading' : available ? 'is-available' : 'is-unavailable';
  return (
    <select
      id={id}
      className={clsx('pim-select pim-atributos-stock', tone)}
      data-stock-select=""
      disabled={loading}
      aria-busy={loading || updating || undefined}
      aria-disabled={updating || undefined}
      value={loading ? '' : available ? 'available' : 'unavailable'}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => radixSelectKeys(event, { typeahead: false })}
    >
      {loading ? <option value="">Cargando...</option> : null}
      <option value="available">✓ Disponible</option>
      <option value="unavailable">✗ No disponible</option>
    </select>
  );
}
