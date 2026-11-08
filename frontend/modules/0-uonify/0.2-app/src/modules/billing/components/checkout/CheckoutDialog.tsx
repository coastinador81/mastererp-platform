import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/modules/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, Icon, KeyValue, LinkButton, Spinner } from '@/shared/ui';
import { billingApi } from '../../api/billingApi';
import { closeBillingDialog } from '../../flows/dialogs';
import { downloadDocument } from '../../flows/documents';
import { refreshBilling, useBillingConfig, useCheckoutPreview, usePaymentMethod } from '../../hooks/useBilling';
import { usePlans } from '../../hooks/usePlans';
import { euros, longDate, tokens } from '../../model/money';
import type { BillingInterval, PlanId } from '../../model/plans';
import type { CheckoutResult } from '../../model/types';
import { cardName } from '../common/CardLabel';
import { LegalChecks, type LegalAcceptance } from './LegalChecks';
import { OrderSummary } from './OrderSummary';
import { PaymentChoice, type PaymentChoiceHandle } from './PaymentChoice';

/**
 * Pago de un plan mensual o anual con el aspecto de Stripe Checkout (simulado): resumen con
 * 13 meses por el precio de 12, «Impuestos no incluidos» y el IVA, tarjeta, casillas
 * legales y confirmación. El plan se activa cuando el servidor confirma el cobro.
 */
export function CheckoutDialog({ id, planId, interval, required = false, onComplete }: {
  id?: number; planId: PlanId; interval: BillingInterval; required?: boolean; onComplete?: () => void;
}) {
  const payment = useRef<PaymentChoiceHandle>(null);
  const client = useQueryClient();
  const preview = useCheckoutPreview(planId, interval);
  const plans = usePlans();
  const config = useBillingConfig();
  const card = usePaymentMethod();
  const [useNewCard, setUseNewCard] = useState(false);
  const [accepted, setAccepted] = useState<LegalAcceptance>({ terms: false, withdrawal: false });
  const [triedPay, setTriedPay] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const withdrawalRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  const pay = useMutation({
    mutationFn: billingApi.checkout,
    onSuccess: async data => {
      setResult(data);
      await refreshBilling(client);
    },
  });

  useEffect(() => {
    if (result) doneRef.current?.focus();
  }, [result]);

  const quote = preview.data;
  const plan = plans.data?.find(item => item.id === planId);
  const planName = quote?.planName ?? plan?.name ?? 'de Uonify';
  const close = () => {
    if (pay.isPending || (required && !result)) return;
    if (required) onComplete?.();
    else if (id !== undefined) closeBillingDialog(id, result ? 'done' : 'cancelled');
  };

  const submit = () => {
    if (!quote || pay.isPending) return;
    if (!accepted.terms || !accepted.withdrawal) {
      setTriedPay(true);
      (accepted.terms ? withdrawalRef : termsRef).current?.focus();
      return;
    }
    const details = payment.current?.read();
    if (!details) return;
    pay.mutate({
      ...details,
      planId,
      interval,
      acceptedTerms: true,
      acceptedWithdrawal: true,
      termsVersion: config.data?.termsVersion ?? '',
    });
  };

  if (result) {
    const { subscription, invoice, paymentMethod } = result;
    const included = plan?.includedTokens ?? 0;
    return (
      <Dialog
        open
        onClose={close}
        title={`Ya tienes el plan ${planName}`}
        description="Pago confirmado"
        footer={
          <>
            <Button icon="download" onClick={() => void downloadDocument(invoice)}>
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
            Hemos cobrado <strong>{euros(invoice.total)}</strong> en tu {cardName(paymentMethod)}. Tu plan {planName} dura hasta el{' '}
            {subscription.renewsAt ? longDate(subscription.renewsAt) : '—'}.
          </p>
        </div>
        <KeyValue
          className="bil-done-facts"
          items={[
            { label: 'Factura', value: invoice.number, mono: true },
            { label: 'Periodo', value: interval === 'monthly' ? '1 mes' : `${subscription.months ?? 13} meses por el precio de 12` },
            { label: 'Puedes desistir hasta', value: subscription.withdrawalUntil ? longDate(subscription.withdrawalUntil) : '—' },
            ...(included > 0 ? [{ label: 'Incluye', value: `${tokens(included)} de Uonify al mes` }] : []),
          ]}
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!required && !pay.isPending}
      title={`Contratar el plan ${planName}`}
      description={interval === 'monthly' ? 'Pago mensual · 1 mes de servicio' : quote ? `Pago anual · ${quote.months} meses por el precio de ${quote.paidMonths}` : 'Pago anual'}
      footer={
        <>
          <Button onClick={required ? () => void signOut() : close} disabled={pay.isPending}>
            {required ? 'Cerrar sesión' : 'Cancelar'}
          </Button>
          <Button variant="primary" icon="shield" loading={pay.isPending} disabled={!quote || card.isPending || card.isError} onClick={submit}>
            {pay.isPending ? 'Procesando el pago…' : quote ? `Pagar ${euros(quote.amounts.total)}` : 'Pagar'}
          </Button>
        </>
      }
    >
      {required ? <p className="bil-fine">Completa el pago para activar tu plan y acceder a tu espacio. Si sales ahora, podrás retomarlo al iniciar sesión.</p> : null}
      {preview.isPending ? (
        <Spinner label="Preparando el pago…" />
      ) : preview.isError || !quote ? (
        <Alert tone="red" role="alert" title="No se ha podido preparar el pago">
          {errorMessage(preview.error)} <LinkButton onClick={() => void preview.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : (
        <div className="bil-checkout">
          <div tabIndex={-1} data-autofocus className="bil-focus-start">
            <OrderSummary quote={quote} />
          </div>
          <PaymentChoice
            ref={payment}
            error={card.isError}
            card={card.data}
            loading={card.isPending}
            useNewCard={useNewCard}
            onUseNewCardChange={setUseNewCard}
            disabled={pay.isPending}
          />
          <LegalChecks
            value={accepted}
            onChange={setAccepted}
            withdrawalUntil={quote.withdrawalUntil}
            showError={triedPay}
            termsRef={termsRef}
            withdrawalRef={withdrawalRef}
            disabled={pay.isPending}
          />
          <p className="bil-fine">
            El plan se cobra hoy por adelantado y se renueva {interval === 'monthly' ? 'cada mes' : `cada ${quote.months} meses`}. Puedes cancelar la renovación cuando quieras en Configuración ›
            Plan y facturación. Este pago autoriza las renovaciones del plan con esta tarjeta. Guardarla para otras compras es opcional.
          </p>
          {pay.isError ? (
            <Alert tone="red" role="alert" title="No se ha podido cobrar">
              {errorMessage(pay.error)}
            </Alert>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
