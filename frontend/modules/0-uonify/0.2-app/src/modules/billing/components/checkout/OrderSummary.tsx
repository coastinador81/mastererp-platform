import { Badge, Meta } from '@/shared/ui';
import { euros, eurosShort, percent, shortDate } from '../../model/money';
import type { CheckoutQuote } from '../../model/types';
import { AmountLines, type AmountLine } from '../common/AmountLines';

/** Resumen del pago según modalidad: 12 cuotas, el mes incluido, descuento al subir, IVA y total. */
export function OrderSummary({ quote }: { quote: CheckoutQuote }) {
  const extraMonths = quote.months - quote.paidMonths;
  const lines: AmountLine[] = [
    { label: `Plan ${quote.planName} · ${quote.paidMonths} × ${eurosShort(quote.monthlyPrice)}`, value: euros(quote.base) },
  ];
  if (extraMonths > 0) {
    lines.push({
      label: extraMonths === 1 ? '1 mes incluido' : `${extraMonths} meses incluidos`,
      note: `${quote.months} meses por el precio de ${quote.paidMonths}`,
      value: 'Incluido',
      tone: 'muted',
    });
  }
  if (quote.credit > 0) {
    lines.push({ label: `Parte no usada del plan ${quote.creditPlanName ?? 'actual'}`, value: euros(-quote.credit), tone: 'discount' });
  }
  lines.push(
    { label: 'Subtotal', note: 'Impuestos no incluidos', value: euros(quote.amounts.base) },
    { label: `IVA (${percent(quote.amounts.vatRate)})`, value: euros(quote.amounts.vat) },
  );
  return (
    <section className="bil-summary" aria-label="Resumen del pago">
      <div className="bil-summary-head">
        <span className="bil-block-title">Resumen</span>
        <Badge tone="outline">Impuestos no incluidos</Badge>
      </div>
      <AmountLines lines={lines} total={{ label: 'Total hoy', value: euros(quote.amounts.total) }} />
      <Meta
        className="bil-summary-meta"
        items={[
          `Del ${shortDate(quote.startsAt)} al ${shortDate(quote.endsAt)}`,
          `Se renueva por ${euros(quote.renewalBase)} + IVA cada ${quote.months === 1 ? 'mes' : `${quote.months} meses`}`,
        ]}
      />
    </section>
  );
}
