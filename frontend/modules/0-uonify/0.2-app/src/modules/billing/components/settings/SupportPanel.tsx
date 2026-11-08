import { useId } from 'react';
import { Badge, Button, LinkButton, Section, SectionHead } from '@/shared/ui';
import { openSupport, stopSupport } from '../../flows/checkout';
import { useBillingConfig } from '../../hooks/useBilling';
import { eurosShort, longDate } from '../../model/money';
import type { SupportState } from '../../model/types';
import { SupportLegalNote, SupportPerks } from '../support/SupportCopy';

/**
 * «Apoya a Uonify» (plan Mecenas). Va al final de la sección, lejos de los avisos
 * de límite: es un apoyo voluntario, nunca una condición para usar Uonify.
 */
export function SupportPanel({ support }: { support: SupportState }) {
  const titleId = useId();
  const config = useBillingConfig();
  const amount = support.active ? support.amount : config.data?.supportAmount;
  return (
    <Section aria-labelledby={titleId} className="bil-block bil-support">
      <SectionHead
        titleId={titleId}
        icon="heart"
        title="Apoya a Uonify"
        actions={
          support.active ? (
            <Badge tone="green" icon="check">
              Partner voluntario
            </Badge>
          ) : (
            <Button icon="heart" onClick={() => void openSupport()} disabled={amount === undefined}>
              Apoya a Uonify
            </Button>
          )
        }
      />
      {support.active ? (
        <p className="bil-current-text">
          Apoyas a Uonify con {amount !== undefined ? eurosShort(amount) : ''} al mes + IVA
          {support.since ? ` desde el ${longDate(support.since)}` : ''}. ¡Gracias!{' '}
          <LinkButton onClick={() => void stopSupport()}>Dejar de apoyar</LinkButton>
        </p>
      ) : (
        <>
          <p className="bil-current-text">
            Construimos Uonify sin inversores. Si te ahorra horas cada semana, puedes apoyar su desarrollo
            {amount !== undefined ? ` por ${eurosShort(amount)} al mes + IVA` : ''}.
          </p>
          <SupportPerks />
          <SupportLegalNote />
        </>
      )}
    </Section>
  );
}
