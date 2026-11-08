import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, ErrorText, Hint, Icon, Input, KeyValue, Label, Spinner } from '@/shared/ui';
import { billingApi } from '../../api/billingApi';
import { closeBillingDialog } from '../../flows/dialogs';
import { downloadDocument } from '../../flows/documents';
import { refreshBilling, useBalance, useBillingConfig, usePaymentMethod } from '../../hooks/useBilling';
import { euros, eurosShort, formatNumber, percent, tokens, tokensLabel } from '../../model/money';
import { parseAmount, rechargeError, rechargeQuote } from '../../model/recharge';
import type { PaymentDetails, RechargeResult } from '../../model/types';
import { AmountLines } from '../common/AmountLines';
import { cardName } from '../common/CardLabel';
import { PaymentChoice, type PaymentChoiceHandle } from '../checkout/PaymentChoice';

/**
 * Recargar tokens de Uonify: importe libre desde la recarga mínima (20 €), sin packs
 * ni descuentos. Cada token vale lo mismo; se enseña siempre su valor en euros.
 */
export function RechargeDialog({ id }: { id: number }) {
  const payment = useRef<PaymentChoiceHandle>(null);
  const client = useQueryClient();
  const config = useBillingConfig();
  const balance = useBalance();
  const card = usePaymentMethod();
  const [text, setText] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [useNewCard, setUseNewCard] = useState(false);
  const [result, setResult] = useState<RechargeResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);

  const recharge = useMutation({
    mutationFn: ({ amount, details }: { amount: number; details: PaymentDetails }) => billingApi.recharge(amount, details),
    onSuccess: async data => {
      setResult(data);
      await refreshBilling(client);
    },
  });

  useEffect(() => {
    if (result) doneRef.current?.focus();
  }, [result]);

  const close = () => closeBillingDialog(id, result ? 'done' : 'cancelled');
  const settings = config.data;
  const value = text ?? (settings ? String(settings.minRecharge) : '');
  const amount = parseAmount(value);
  const problem = settings ? rechargeError(amount, settings) : null;
  const quote = settings && amount !== null && !problem ? rechargeQuote(amount, settings) : null;

  const submit = () => {
    setTouched(true);
    if (!quote || amount === null || recharge.isPending) {
      inputRef.current?.focus();
      return;
    }
    const details = payment.current?.read();
    if (details) recharge.mutate({ amount, details });
  };

  if (result && settings) {
    return (
      <Dialog
        open
        onClose={close}
        title="Recarga hecha"
        description={`${tokens(result.movement.tokens)} de Uonify más en tu saldo`}
        footer={
          <>
            <Button icon="download" onClick={() => void downloadDocument(result.invoice)}>
              Descargar factura
            </Button>
            <Button ref={doneRef} variant="primary" onClick={close}>
              Listo
            </Button>
          </>
        }
      >
        <div className="bil-done" role="status">
          <Icon name="check-circle" size={28} className="bil-done-icon" />
          <p>
            Tu saldo es ahora de <strong>{tokensLabel(result.balance.tokens, result.balance.tokenPrice)}</strong>.
          </p>
        </div>
        <KeyValue
          className="bil-done-facts"
          items={[
            { label: 'Factura', value: result.invoice.number, mono: true },
            { label: 'Cobrado', value: `${euros(result.invoice.total)} en tu ${cardName(result.paymentMethod)}` },
          ]}
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!recharge.isPending}
      title="Recargar tokens de Uonify"
      description={settings ? `Desde ${eurosShort(settings.minRecharge)}. Cada token vale ${euros(settings.tokenPrice)}, sin packs ni descuentos.` : undefined}
      footer={
        <>
          <Button onClick={close} disabled={recharge.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" icon="shield" loading={recharge.isPending} disabled={!settings || card.isPending || card.isError} onClick={submit}>
            {recharge.isPending ? 'Procesando el pago…' : quote ? `Pagar ${euros(quote.amounts.total)}` : 'Pagar'}
          </Button>
        </>
      }
    >
      {!settings ? (
        config.isError ? (
          <Alert tone="red" role="alert">
            {errorMessage(config.error)}
          </Alert>
        ) : (
          <Spinner label="Cargando…" />
        )
      ) : (
        <div className="bil-recharge">
          {balance.data ? (
            <p className="bil-muted-line">
              Saldo actual: <strong>{tokensLabel(balance.data.tokens, balance.data.tokenPrice)}</strong>
            </p>
          ) : null}
          <div className="pim-field">
            <Label htmlFor={fieldId}>Importe de la recarga</Label>
            <div className="bil-amount">
              <Input
                id={fieldId}
                ref={inputRef}
                data-autofocus
                inputMode="decimal"
                autoComplete="off"
                value={value}
                invalid={touched && !!problem}
                aria-describedby={touched && problem ? `${fieldId}-hint ${fieldId}-error` : `${fieldId}-hint`}
                disabled={recharge.isPending}
                onChange={event => setText(event.target.value)}
                onBlur={() => setTouched(true)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <span className="bil-amount-unit" aria-hidden="true">
                €
              </span>
            </div>
            <Hint id={`${fieldId}-hint`}>{`Mínimo ${eurosShort(settings.minRecharge)}, impuestos aparte.`}</Hint>
            {touched && problem ? <ErrorText id={`${fieldId}-error`}>{problem}</ErrorText> : null}
          </div>
          {quote ? (
            <>
              <p className="bil-recharge-tokens" aria-live="polite">
                Recibirás <strong>{formatNumber(quote.tokens)} tokens</strong> de Uonify
              </p>
              <AmountLines
                aria-label="Resumen de la recarga"
                lines={[
                  { label: 'Recarga', note: 'Impuestos no incluidos', value: euros(quote.amounts.base) },
                  { label: `IVA (${percent(quote.amounts.vatRate)})`, value: euros(quote.amounts.vat) },
                ]}
                total={{ label: 'Total', value: euros(quote.amounts.total) }}
              />
            </>
          ) : null}
          <PaymentChoice ref={payment} error={card.isError} card={card.data} loading={card.isPending} useNewCard={useNewCard} onUseNewCardChange={setUseNewCard} disabled={recharge.isPending} />
          {recharge.isError ? (
            <Alert tone="red" role="alert" title="No se ha podido recargar">
              {errorMessage(recharge.error)}
            </Alert>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
