import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, Icon, KeyValue, Spinner } from '@/shared/ui';
import { billingApi } from '../../api/billingApi';
import { closeBillingDialog } from '../../flows/dialogs';
import { downloadDocument } from '../../flows/documents';
import { refreshBilling, useBillingConfig, usePaymentMethod } from '../../hooks/useBilling';
import { euros, percent } from '../../model/money';
import { withVat } from '../../model/quote';
import type { SupportResult } from '../../model/types';
import { AmountLines } from '../common/AmountLines';
import { PaymentChoice, type PaymentChoiceHandle } from '../checkout/PaymentChoice';
import { SupportLegalNote, SupportPerks } from './SupportCopy';

/**
 * «Apoya a Uonify» (plan Mecenas): suscripción de apoyo con factura, por el importe
 * que fija admin. Quien apoya es «partner voluntario» con un voto simbólico, no
 * vinculante, en la hoja de ruta. Nunca aparece junto a los avisos de límite.
 */
export function SupportDialog({ id }: { id: number }) {
  const payment = useRef<PaymentChoiceHandle>(null);
  const [useNewCard, setUseNewCard] = useState(false);
  const client = useQueryClient();
  const config = useBillingConfig();
  const card = usePaymentMethod();
  const [result, setResult] = useState<SupportResult | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const support = useMutation({
    mutationFn: billingApi.startSupport,
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
  const amounts = settings ? withVat(settings.supportAmount, settings.vatRate) : null;

  if (result) {
    return (
      <Dialog
        open
        onClose={close}
        title="¡Gracias por apoyar a Uonify!"
        description="Ya eres partner voluntario."
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
          <Icon name="heart" size={28} className="bil-done-icon" />
          <p>Tu apoyo nos ayuda a seguir construyendo Uonify sin inversores. Cuando votemos la hoja de ruta, te lo contaremos.</p>
        </div>
        <KeyValue className="bil-done-facts" items={[{ label: 'Factura', value: result.invoice.number, mono: true }]} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!support.isPending}
      title="Apoya a Uonify"
      description="Construimos Uonify sin inversores. Si te ahorra horas cada semana, puedes apoyar su desarrollo."
      footer={
        <>
          <Button onClick={close} disabled={support.isPending}>
            Ahora no
          </Button>
          <Button variant="primary" icon="heart" loading={support.isPending} disabled={!amounts || card.isPending || card.isError} onClick={() => { const details = payment.current?.read(); if (details) support.mutate(details); }}>
            {amounts ? `Apoyar con ${euros(amounts.total)} al mes` : 'Apoyar'}
          </Button>
        </>
      }
    >
      {!settings || !amounts ? (
        config.isError ? (
          <Alert tone="red" role="alert">
            {errorMessage(config.error)}
          </Alert>
        ) : (
          <Spinner label="Cargando…" />
        )
      ) : (
        <div className="bil-support-dialog">
          <SupportPerks />
          <AmountLines
            aria-label="Resumen del apoyo"
            lines={[
              { label: 'Apoyo mensual', note: 'Impuestos no incluidos', value: euros(amounts.base) },
              { label: `IVA (${percent(amounts.vatRate)})`, value: euros(amounts.vat) },
            ]}
            total={{ label: 'Total al mes', value: euros(amounts.total) }}
          />
          <PaymentChoice ref={payment} card={card.data} error={card.isError} loading={card.isPending} useNewCard={useNewCard} onUseNewCardChange={setUseNewCard} disabled={support.isPending} />
          <p className="bil-fine">Este pago autoriza el apoyo mensual con esta tarjeta. Guardarla para otras compras es opcional.</p>
          <SupportLegalNote />
          {support.isError ? (
            <Alert tone="red" role="alert" title="No se ha podido completar el pago">
              {errorMessage(support.error)}
            </Alert>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
