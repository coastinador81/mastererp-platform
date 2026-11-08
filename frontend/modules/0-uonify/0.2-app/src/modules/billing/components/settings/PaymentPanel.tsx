import { useId } from 'react';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, LinkButton, Section, SectionHead, Spinner } from '@/shared/ui';
import { openPaymentMethod } from '../../flows/checkout';
import { usePaymentMethod } from '../../hooks/useBilling';
import { CardLabel } from '../common/CardLabel';

/** Método de pago como lo enseña Stripe: marca, últimos 4 dígitos y caducidad. */
export function PaymentPanel() {
  const titleId = useId();
  const card = usePaymentMethod();
  return (
    <Section aria-labelledby={titleId} className="bil-block">
      <SectionHead
        titleId={titleId}
        icon="bil-card"
        title="Método de pago"
        actions={
          <Button icon="edit" onClick={() => void openPaymentMethod()}>
            {card.data ? 'Cambiar tarjeta' : 'Añadir tarjeta'}
          </Button>
        }
      />
      {card.isPending ? (
        <Spinner label="Cargando tu método de pago…" />
      ) : card.isError ? (
        <Alert tone="red" role="alert">
          {errorMessage(card.error, 'No se ha podido cargar tu método de pago.')} <LinkButton onClick={() => void card.refetch()}>Reintentar</LinkButton>
        </Alert>
      ) : card.data ? (
        <div className="bil-payment">
          <CardLabel card={card.data} />
        </div>
      ) : (
        <p className="bil-muted-line">Aún no tienes ninguna tarjeta guardada.</p>
      )}
      <p className="bil-fine">Solo aparecen aquí las tarjetas que eliges guardar para próximos pagos.</p>
    </Section>
  );
}
