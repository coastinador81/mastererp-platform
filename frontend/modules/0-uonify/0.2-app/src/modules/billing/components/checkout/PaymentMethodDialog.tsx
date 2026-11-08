import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, toast } from '@/shared/ui';
import { billingApi } from '../../api/billingApi';
import { closeBillingDialog } from '../../flows/dialogs';
import { refreshBilling, usePaymentMethod } from '../../hooks/useBilling';
import { CardLabel, cardName } from '../common/CardLabel';
import { StripeCardMock, type CardEntry } from './StripeCardMock';

/**
 * Cambiar la tarjeta con el formulario de Stripe (simulado). Stripe guarda la
 * tarjeta y el servidor solo recibe su identificador.
 */
export function PaymentMethodDialog({ id }: { id: number }) {
  const entry = useRef<CardEntry>(null);
  const client = useQueryClient();
  const current = usePaymentMethod();
  const save = useMutation({
    mutationFn: billingApi.replacePaymentMethod,
    onSuccess: async card => {
      await refreshBilling(client);
      toast.success('Tarjeta actualizada', { description: `Los próximos cobros irán a tu ${cardName(card)}.` });
      closeBillingDialog(id, 'done');
    },
  });
  const close = () => closeBillingDialog(id, 'cancelled');
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!save.isPending}
      title={current.data ? "Cambiar método de pago" : "Añadir método de pago"}
      description="La nueva tarjeta se usará para la renovación, las recargas y «Apoya a Uonify»."
      footer={
        <>
          <Button onClick={close} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" icon="shield" loading={save.isPending} disabled={current.isPending || current.isError} onClick={() => { const card = entry.current?.read(); if (card) save.mutate(card); }}>
            {save.isPending ? 'Guardando…' : 'Guardar tarjeta'}
          </Button>
        </>
      }
    >
      <div className="bil-payment-dialog">
        {current.data ? (
          <p className="bil-muted-line">
            Ahora: <CardLabel card={current.data} />
          </p>
        ) : null}
        <StripeCardMock ref={entry} disabled={save.isPending} />
        {save.isError ? (
          <Alert tone="red" role="alert" title="No se ha podido guardar la tarjeta">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
