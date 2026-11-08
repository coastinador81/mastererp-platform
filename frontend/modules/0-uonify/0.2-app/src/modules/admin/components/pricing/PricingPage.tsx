import { useState } from 'react';
import { Button, Field, Input, toast } from '@/shared/ui';
import { useHelpConfig, useUpdateHelpConfig } from '../../hooks/useExternal';
import { useAdminMember } from '../../hooks/useAdminSession';
import { can } from '../../model/permissions';
import type { HelpConfigView } from '../../model/types';
import { formatEuro } from '../../model/format';
import { PageHeader, QueryState } from '../common/PageParts';
import { ReasonDialog } from '../common/ReasonDialog';

/** Oferta de suscripción vigente (sin tokens). El precio es editable por el equipo. */
interface Subscription {
  monthlyEur: number;
  annualEur: number;
  trialDays: number;
}

const INITIAL: Subscription = { monthlyEur: 9.9, annualEur: 118.8, trialDays: 14 };

export function PricingPage() {
  const help = useHelpConfig();
  const editable = can(useAdminMember().role, 'pricing.edit');
  const [sub, setSub] = useState<Subscription>(INITIAL);
  const [editing, setEditing] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  return (
    <div className="adm-page">
      <PageHeader
        title="Suscripción y precios"
        description="El precio de la suscripción y las condiciones que ven los clientes. Al guardar se publica una versión nueva de la oferta; el histórico se conserva. Los importes son antes de IVA."
      />
      <div className="adm-grid-2">
        <section className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2>Suscripción Uonify</h2>
              <p>Un único plan. Incluye el acceso a las herramientas presentes y futuras mientras la suscripción esté vigente.</p>
            </div>
          </div>
          <div className="adm-stats">
            <StatLine label="Mensual" value={`${formatEuro(sub.monthlyEur)} al mes`} />
            <StatLine label="Anual" value={`${formatEuro(sub.annualEur)} al año`} hint="Sin descuento sobre el mensual" />
            <StatLine label="Prueba gratuita" value={`${sub.trialDays} días`} hint="Tarjeta al activar; pago al entrar" />
          </div>
          <p className="adm-inline-note" style={{ marginTop: 12 }}>
            El cliente paga su consumo de IA (imágenes, vídeo, voz) desde su propia cuenta de Google, bajo las condiciones de Google. La suscripción no incluye saldo ni tokens.
          </p>
          {editable ? (
            <Button onClick={() => setEditing(true)}>Editar la suscripción</Button>
          ) : null}
        </section>
        <section className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2>Videollamada de soporte</h2>
              <p>Sesión de ayuda con una persona del equipo por Google Meet. Precio editable.</p>
            </div>
          </div>
          <QueryState isPending={help.isPending} error={help.error} onRetry={() => void help.refetch()}>
            {help.data ? (
              <>
                <div className="adm-stats">
                  <StatLine label="Precio" value={formatEuro(help.data.videoCallPrice ?? 0)} />
                  <StatLine label="Duración" value={`${help.data.videoCallMinutes ?? 30} min`} />
                </div>
                {editable ? <Button onClick={() => setCallOpen(true)}>Editar la videollamada</Button> : null}
              </>
            ) : null}
          </QueryState>
        </section>
      </div>
      {editing ? <SubscriptionEditor sub={sub} onSave={setSub} onClose={() => setEditing(false)} /> : null}
      {callOpen && help.data ? <VideoCallEditor help={help.data} onClose={() => setCallOpen(false)} /> : null}
    </div>
  );
}

function StatLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <strong className="adm-stat-value">{value}</strong>
      {hint ? <span className="adm-stat-hint">{hint}</span> : null}
    </div>
  );
}

function SubscriptionEditor({ sub, onSave, onClose }: { sub: Subscription; onSave: (next: Subscription) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Subscription>(sub);
  const field = (key: keyof Subscription, label: string, hint?: string) => (
    <Field key={key} label={label} hint={hint}>
      <Input type="number" min={0} step={key === 'trialDays' ? 1 : 0.01} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} />
    </Field>
  );
  return (
    <ReasonDialog
      open
      title="Editar la suscripción"
      confirmLabel="Publicar versión"
      onClose={onClose}
      validate={() => (draft.monthlyEur <= 0 || draft.annualEur <= 0 ? 'Los precios deben ser positivos.' : draft.trialDays < 0 ? 'La prueba no puede ser negativa.' : null)}
      onConfirm={async () => {
        onSave(draft);
        toast.success('Nueva versión de la oferta publicada.');
      }}
    >
      {field('monthlyEur', 'Precio mensual (€, antes de IVA)')}
      {field('annualEur', 'Precio anual (€, antes de IVA)')}
      {field('trialDays', 'Días de prueba gratuita')}
    </ReasonDialog>
  );
}

function VideoCallEditor({ help, onClose }: { help: HelpConfigView; onClose: () => void }) {
  const [price, setPrice] = useState(help.videoCallPrice ?? 30);
  const update = useUpdateHelpConfig();
  return (
    <ReasonDialog
      open
      title="Editar la videollamada"
      confirmLabel="Guardar precio"
      onClose={onClose}
      validate={() => (!Number.isFinite(price) || price <= 0 ? 'El precio debe ser positivo.' : null)}
      onConfirm={reason => update.mutateAsync({ config: help, price, reason, detail: 'Actualización del precio de la videollamada.' })}
    >
      <Field label="Precio de la videollamada (€)">
        <Input type="number" min={1} value={price} onChange={event => setPrice(Number(event.target.value))} />
      </Field>
    </ReasonDialog>
  );
}
