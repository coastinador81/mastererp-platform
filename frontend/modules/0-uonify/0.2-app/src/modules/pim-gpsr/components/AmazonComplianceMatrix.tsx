import { Icon } from '@/shared/ui';
import { renderViaB, storeName, unconfirmedStores, type AmazonCompliance } from '../model/amazonViaB';
import '../styles/amazon-via-b.css';

/**
 * Matriz de la vía B de Amazon: UNA casilla por tienda UE, cada una con el texto
 * legal EXACTO que nombra esa tienda (§8). Se usa igual en el perfil de marca
 * (con Brand Registry) y en la pestaña del producto (sin Brand Registry); solo
 * cambia el `template`. Presentacional; la fecha/usuario los estampa el backend.
 */
export function AmazonComplianceMatrix({ stores, template, value, onChange }:
  { stores: readonly string[]; template: string; value: AmazonCompliance; onChange?: (next: AmazonCompliance) => void }) {
  const set = (iso2: string, confirmed: boolean) => onChange?.({ ...value, [iso2]: { ...value[iso2], confirmed } });
  const pending = unconfirmedStores([...stores], value);
  if (!stores.length) return <p className="amz-viab-empty">Elige primero las tiendas de Amazon donde vendes.</p>;
  return (
    <div className="amz-viab">
      <ul className="amz-viab-list">
        {stores.map(iso2 => (
          <li key={iso2}>
            <label className="amz-viab-row">
              <input type="checkbox" checked={!!value[iso2]?.confirmed} onChange={e => set(iso2, e.target.checked)} />
              <span><strong>{storeName(iso2)}</strong><span className="amz-viab-text">{renderViaB(template, [storeName(iso2)])}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <p className={pending.length ? 'amz-viab-note' : 'amz-viab-note ok'}>
        <Icon name={pending.length ? 'alert-circle' : 'check-circle'} size={14} />
        {pending.length
          ? `Falta confirmar: ${pending.map(storeName).join(', ')}. Cada tienda nueva pide su propia confirmación.`
          : 'Confirmado en todas las tiendas elegidas.'}
      </p>
    </div>
  );
}
