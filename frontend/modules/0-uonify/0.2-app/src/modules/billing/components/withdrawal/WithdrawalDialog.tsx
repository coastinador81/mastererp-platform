import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, Icon, IconButton, LinkButton, Spinner } from '@/shared/ui';
import { billingApi } from '../../api/billingApi';
import { closeBillingDialog } from '../../flows/dialogs';
import { documentTitle, downloadDocument } from '../../flows/documents';
import { refreshBilling, usePaymentMethod, useWithdrawalPreview } from '../../hooks/useBilling';
import { euros, formatNumber, longDate, percent } from '../../model/money';
import type { BillingDocument, WithdrawalPreview, WithdrawalResult } from '../../model/types';
import { AmountLines } from '../common/AmountLines';
import { cardName } from '../common/CardLabel';

/**
 * Desistimiento de 14 días: vista previa de la devolución (lo pagado menos los
 * tokens de Uonify del plan gastados, a precio de tarifa), confirmación y, al
 * terminar, la nota de crédito y la factura rectificativa para descargar.
 */
export function WithdrawalDialog({ id }: { id: number }) {
  const client = useQueryClient();
  const preview = useWithdrawalPreview();
  const card = usePaymentMethod();
  const [result, setResult] = useState<WithdrawalResult | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const withdraw = useMutation({
    mutationFn: billingApi.withdraw,
    onSuccess: async data => {
      setResult(data);
      await refreshBilling(client);
    },
  });

  useEffect(() => {
    if (result) doneRef.current?.focus();
  }, [result]);

  const close = () => closeBillingDialog(id, result ? 'done' : 'cancelled');
  const data = preview.data;

  if (result) {
    const refundCard = result.paymentMethod ?? card.data;
    return (
      <Dialog
        open
        onClose={close}
        title="Has desistido del plan"
        description="Tu cuenta ya está en el plan Gratis. No se ha borrado nada."
        footer={
          <Button ref={doneRef} variant="primary" onClick={close}>
            Listo
          </Button>
        }
      >
        <div className="bil-done" role="status">
          <Icon name="check-circle" size={28} className="bil-done-icon" />
          <p>
            Te devolvemos <strong>{euros(result.refund.total)}</strong>
            {refundCard ? ` en tu ${cardName(refundCard)}` : ''}. Suele tardar de 5 a 10 días hábiles en aparecer.
          </p>
        </div>
        <ul className="bil-docs" aria-label="Documentos del desistimiento">
          <DocumentRow doc={result.creditNote} />
          <DocumentRow doc={result.correctiveInvoice} />
        </ul>
      </Dialog>
    );
  }

  const eligible = data?.eligible === true;
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!withdraw.isPending}
      title={data ? `Desistir del plan ${data.planName}` : 'Desistir del plan'}
      description={data?.deadline && eligible ? `Puedes hacerlo hasta el ${longDate(data.deadline)}.` : undefined}
      footer={
        <>
          <Button onClick={close} disabled={withdraw.isPending}>
            {eligible ? `Seguir con ${data?.planName ?? 'mi plan'}` : 'Cerrar'}
          </Button>
          {eligible && data ? (
            <Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {withdraw.isPending ? 'Procesando la devolución…' : `Desistir y recibir ${euros(data.refund.total)}`}
            </Button>
          ) : null}
        </>
      }
    >
      {preview.isPending ? (
        <Spinner label="Calculando la devolución…" />
      ) : preview.isError || !data ? (
        <Alert tone="red" role="alert" title="No se ha podido calcular la devolución">
          {errorMessage(preview.error)} <LinkButton onClick={() => void preview.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : !eligible ? (
        <Alert tone="amber" role="note">
          {data.reason === 'expired'
            ? 'El plazo de 14 días para desistir ya ha terminado. Puedes cancelar la renovación y seguir con tu plan hasta el final del periodo.'
            : 'No tienes un plan de pago del que desistir.'}
        </Alert>
      ) : (
        <WithdrawalSummary data={data} cardLabel={card.data ? cardName(card.data) : null} error={withdraw.isError ? errorMessage(withdraw.error) : null} />
      )}
    </Dialog>
  );
}

function WithdrawalSummary({ data, cardLabel, error }: { data: WithdrawalPreview; cardLabel: string | null; error: string | null }) {
  const paid = data.paid;
  return (
    <div className="bil-withdrawal" tabIndex={-1} data-autofocus>
      {paid && data.paidAt ? (
        <p>
          Pagaste {euros(paid.total)} el {longDate(data.paidAt)}
          {data.invoiceNumber ? ` (factura ${data.invoiceNumber})` : ''}. Te devolvemos lo pagado menos los tokens de Uonify del plan que
          has gastado desde entonces, a precio de tarifa.
        </p>
      ) : null}
      <AmountLines
        aria-label="Cálculo de la devolución"
        lines={[
          { label: `Plan ${data.planName}`, note: 'Impuestos no incluidos', value: euros(paid?.base ?? 0) },
          {
            label: 'Tokens de Uonify del plan gastados',
            note: `${formatNumber(data.tokensSpent)} tokens × ${euros(data.tokenPrice)}`,
            value: euros(-data.spentValue),
            tone: 'discount',
          },
          { label: 'Base a devolver', value: euros(data.refund.base) },
          { label: `IVA (${percent(data.refund.vatRate)})`, value: euros(data.refund.vat) },
        ]}
        total={{ label: 'Total a devolver', value: euros(data.refund.total) }}
      />
      <ul className="bil-bullets">
        <li>Lo recibes{cardLabel ? ` en tu ${cardLabel}` : ' en tu tarjeta'} en unos 5 a 10 días hábiles.</li>
        <li>Emitimos una nota de crédito y una factura rectificativa{data.invoiceNumber ? ` de la factura ${data.invoiceNumber}` : ''}.</li>
        <li>Tu cuenta pasa al plan Gratis. No se borra nada: tus productos y datos siguen aquí.</li>
        <li>Los tokens que recargaste aparte ya están pagados: no se descuentan y siguen en tu saldo.</li>
      </ul>
      {error ? (
        <Alert tone="red" role="alert" title="No se ha podido completar el desistimiento">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}

function DocumentRow({ doc }: { doc: BillingDocument }) {
  const title = documentTitle(doc);
  return (
    <li className="bil-doc">
      <Icon name="bil-receipt" size={16} />
      <span className="bil-doc-text">
        <strong>{title}</strong>
        <small>{euros(doc.total)}</small>
      </span>
      <IconButton icon="download" label={`Descargar ${title} en PDF`} onClick={() => void downloadDocument(doc)} />
    </li>
  );
}
