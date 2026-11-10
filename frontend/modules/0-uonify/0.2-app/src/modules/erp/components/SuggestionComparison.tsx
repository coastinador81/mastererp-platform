import clsx from 'clsx';
import { bolivares, totalOf, type Proposal } from '../model/suggestions';
import { Section } from './SheetParts';

export interface SuggestionComparisonProps {
  original: Proposal;
  node?: Proposal | null;
  final?: Proposal | null;
  /** Borrador de la revisión en curso (se pinta en su columna mientras no se confirma). */
  draft?: Proposal | null;
  draftStage?: 'node' | 'purchasing' | null;
}

const ROWS: ReadonlyArray<['quantity' | 'price' | 'supplier' | 'total', string]> = [
  ['quantity', 'Cantidad'],
  ['price', 'Precio estimado'],
  ['supplier', 'Proveedor'],
  ['total', 'Total estimado'],
];

function cell(value: Proposal | null | undefined, key: (typeof ROWS)[number][0]): string {
  if (!value) return 'Pendiente';
  if (key === 'price') return bolivares(Number(value.price));
  if (key === 'total') return bolivares(totalOf(value));
  return String(value[key]);
}

/**
 * «Propuesta y cambios por revisión» de la demo del equipo (SuggestionComparison.jsx): la
 * recomendación original, la versión del Jefe de nodo y la del Jefe de compras, marcando
 * lo que cambia frente a la anterior.
 */
export function SuggestionComparison({ original, node, final, draft = null, draftStage = null }: SuggestionComparisonProps) {
  const nodeValue = node ?? (draftStage === 'node' ? draft : null);
  const finalValue = final ?? (draftStage === 'purchasing' ? draft : null);
  return (
    <Section title="Propuesta y cambios por revisión">
      <p className="pim-section-sub erp-note">La recomendación original se conserva. Cada revisión muestra su propia versión.</p>
      <div className="erp-table-scroll">
        <table className="erp-table erp-table-narrow">
          <thead>
            <tr>
              <th scope="col">Dato</th>
              <th scope="col">Recomendación IA · DEMO</th>
              <th scope="col">Jefe de nodo{draftStage === 'node' ? ' · borrador de revisión' : ''}</th>
              <th scope="col">Jefe de compras{draftStage === 'purchasing' ? ' · borrador de revisión' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([key, label]) => {
              const byNode = Boolean(nodeValue) && cell(nodeValue, key) !== cell(original, key);
              const byPurchasing = Boolean(finalValue && nodeValue) && cell(finalValue, key) !== cell(nodeValue, key);
              return (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{cell(original, key)}</td>
                  <td className={clsx(byNode && 'erp-review-changed')}>
                    {cell(nodeValue, key)}
                    {byNode ? <small className="erp-review-time">Modificado frente a IA</small> : null}
                  </td>
                  <td className={clsx(byPurchasing && 'erp-review-changed')}>
                    {cell(finalValue, key)}
                    {byPurchasing ? <small className="erp-review-time">Modificado frente al nodo</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
