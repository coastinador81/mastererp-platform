import { Icon } from '@/shared/ui';
import { currencyLabel, dateLabel, money, type DemoPurchase } from '../model/demoPurchases';
import { reviewTime } from '../model/suggestions';
import { Fields, Section, SheetHeader, mono } from './SheetParts';
import { SuggestionComparison } from './SuggestionComparison';

/**
 * Ficha de una compra u orden de ejemplo con las secciones, los campos y los textos
 * literales de la ficha de la demo del equipo (2.2-finance/src/local/
 * PurchasesListPreview.jsx:28-61), incluida la variante de una compra que sale de una
 * sugerencia aprobada, pintada con la cabecera de las fichas de Producto y el kit (pim-*).
 * Lo que no existe en la demo se dice («Sin definir», «No vinculada»…): no se inventa.
 */
export interface PurchaseSheetProps {
  purchase: DemoPurchase;
  /** Compras u Órdenes de compra: la demo cambia la fecha, el origen, la recepción y la aprobación. */
  kind?: 'purchases' | 'orders';
  onClose: (detail: number) => void;
}

interface Line {
  code: string;
  description: string;
  quantity: number;
  price: number;
  amount: number;
}

function linesOf(purchase: DemoPurchase): Line[] {
  const fromSuggestion = purchase.fromSuggestion;
  if (fromSuggestion) {
    const { quantity, price } = fromSuggestion.final;
    return [{ code: `DEMO-STOCK-${fromSuggestion.id}`, description: purchase.concept, quantity, price, amount: purchase.total }];
  }
  const cents = Math.round(purchase.total * 100);
  const first = Math.floor(cents * 0.6);
  const service = /servicio|mantenimiento/i.test(purchase.concept);
  return [
    { code: 'DEMO-ITEM-01', description: purchase.concept, quantity: 1, price: first / 100, amount: first / 100 },
    { code: 'DEMO-ITEM-02', description: service ? 'Servicio complementario DEMO' : 'Suministros complementarios DEMO', quantity: 1, price: (cents - first) / 100, amount: (cents - first) / 100 },
  ];
}

export function PurchaseSheet({ purchase, kind = 'purchases', onClose }: PurchaseSheetProps) {
  const orders = kind === 'orders';
  const suggestion = purchase.fromSuggestion;
  const currency = currencyLabel(purchase.currency);
  const service = /servicio|mantenimiento/i.test(purchase.concept);
  const amount = (value: number) => mono(`${currency} ${money(value)}`);
  const approval = suggestion ? 'Jefe de nodo + Jefe de compras · DEMO sin identidad autenticada' : orders ? 'Estado ilustrativo · sin aprobación real' : 'Sin registrar';
  return (
    <div className="product-editor-layout erp-sheet">
      <SheetHeader
        icon={<Icon name="file" size={26} strokeWidth={1.7} />}
        title={purchase.reference}
        monoTitle
        subtitle={purchase.concept}
        status={`Datos ficticios · ${purchase.status}`}
        closeLabel="Cerrar ficha"
        onClose={onClose}
      />
      <div className="product-editor-surface pim-tab">
        <Section title="Información general">
          <Fields items={[
            ['Referencia', mono(purchase.reference)],
            ['Estado', purchase.status],
            [orders ? 'Fecha de la orden' : 'Fecha de compra', mono(dateLabel(purchase.date))],
            ['Empresa', 'Empresa de ejemplo DEMO'],
            ['Nodo', purchase.node],
            ['Responsable', 'Comprador de ejemplo DEMO'],
            ['Origen', purchase.source ? mono(purchase.source) : 'Registro manual DEMO'],
            ['Moneda', currency],
            ['Tipo de cambio', 'Sin definir · no se convierte a moneda base'],
            ['Versión', '1 · ejemplo visual'],
          ]} />
        </Section>
        <Section title="Proveedor">
          <Fields items={[
            ['Nombre', purchase.supplier],
            ['Código interno', mono(`DEMO-PROV-${purchase.reference.slice(-3)}`)],
            ['Identificación fiscal', 'DEMO · no válida para uso fiscal'],
            ['Dirección', 'Dirección de ejemplo · sin datos reales'],
            ['Contacto', 'Contacto de compras DEMO'],
            ['Correo', 'compras@example.invalid'],
            ['Teléfono', 'No especificado'],
          ]} />
        </Section>
        <Section
          title="Productos y servicios"
          note={`${suggestion ? 'Valores finales de la propuesta revisada.' : 'Distribución ilustrativa del importe.'} Descuentos e impuestos sin configurar; no se asumen tasas ni reglas fiscales.`}
        >
          <div className="erp-table-scroll">
            <table className="erp-table">
              <thead>
                <tr>{['Código', 'Descripción', 'Tipo', 'Cantidad', 'Unidad', 'Precio unitario', 'Descuento', 'Impuestos', 'Total'].map(label => <th scope="col" key={label}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {linesOf(purchase).map(line => (
                  <tr key={line.code}>
                    <td className="pim-mono">{line.code}</td>
                    <td>{line.description}</td>
                    <td>{service ? 'Servicio' : 'Producto'}</td>
                    <td className="erp-num">{line.quantity}</td>
                    <td>{service ? 'Servicio' : 'Unidad'}</td>
                    <td className="erp-num">{amount(line.price)}</td>
                    <td>Sin definir</td>
                    <td>Sin definir</td>
                    <td className="erp-num">{amount(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Condiciones y entrega">
          <Fields items={[
            ['Forma de pago', 'Pendiente de acordar'],
            ['Plazo y vencimiento', 'Sin definir'],
            ['Pronto pago', 'Sin condiciones definidas'],
            ['Entrega prevista', 'Sin programar'],
            ['Destino', purchase.node],
            ['Dirección de entrega', 'Por confirmar'],
            ['Recepción', orders ? 'Consultar detalle de recepción · no conectado' : 'No registrada'],
            ['Reserva financiera', 'No vinculada'],
          ]} />
        </Section>
        <Section title="Resumen de importes" note="Esta ficha no genera deuda, pagos, reservas ni movimientos de inventario.">
          <Fields items={[
            ['Importe de líneas', amount(purchase.total)],
            ['Descuentos', 'Sin definir'],
            ['Impuestos y otros cargos', 'Sin definir'],
            ['Total de ejemplo', amount(purchase.total)],
            ['Importe en moneda base', 'Sin calcular'],
            ['Cuenta por pagar', 'No generada'],
            ['Pagos', 'No registrados'],
          ]} />
        </Section>
        <Section title="Documentos relacionados y soportes">
          <Fields items={[
            ['Compra de origen', purchase.source ? mono(purchase.source) : 'No vinculada'],
            ['Orden de compra', orders ? mono(purchase.reference) : 'No vinculada'],
            ['Factura de proveedor', 'No vinculada'],
            ['Recepciones', 'Sin documentos'],
            ['Notas de crédito y devoluciones', 'Sin documentos'],
            ['Archivos adjuntos', 'Sin archivos'],
          ]} />
        </Section>
        {suggestion ? <SuggestionComparison original={suggestion.original} node={suggestion.node} final={suggestion.final} /> : null}
        <Section title="Observaciones y trazabilidad">
          <p className="pim-section-sub erp-note">Compra ficticia para revisar la ficha y su navegación. No representa una operación real.</p>
          <Fields items={[
            ['Creado por', 'Usuario DEMO'],
            ['Fecha de ejemplo', mono(dateLabel(purchase.date))],
            ['Última modificación', 'Sin modificaciones'],
            ['Aprobación', approval],
            ['Fecha y hora · revisión del nodo DEMO', suggestion ? reviewTime(suggestion.nodeReviewedAt) : 'No aplica'],
            ['Observaciones del Jefe de nodo', suggestion?.nodeObservation || 'Sin observaciones'],
            ['Observaciones del Jefe de compras', suggestion?.purchasingObservation || 'Sin observaciones'],
            ['Prioridad', suggestion?.priority ? 'Prioritaria' : 'Normal'],
            ['Fecha y hora · Jefe de compras DEMO', suggestion ? reviewTime(suggestion.approvedAt) : 'No aplica'],
          ]} />
        </Section>
      </div>
    </div>
  );
}
