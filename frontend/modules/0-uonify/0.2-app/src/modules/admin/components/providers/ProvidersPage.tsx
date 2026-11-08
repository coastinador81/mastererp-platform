import { useState } from 'react';
import { Button, Checkbox, Field, Input } from '@/shared/ui';
import { useProviders, useUpdateProvider } from '../../hooks/useOperations';
import { useAdminMember } from '../../hooks/useAdminSession';
import { can } from '../../model/permissions';
import { formatUsd } from '../../model/format';
import type { AiProvider } from '../../model/types';
import { PageHeader, QueryState, Meter } from '../common/PageParts';
import { ReasonDialog } from '../common/ReasonDialog';
export function ProvidersPage() {
  const query = useProviders(); const member = useAdminMember(); const [editing, setEditing] = useState<AiProvider | null>(null);
  return <div className="adm-page"><PageHeader title="Proveedores de IA" description="Servicios de IA que paga Uonify (soporte de Uony, voz e infraestructura), con su disponibilidad y tope de gasto. El consumo de imágenes y vídeo del cliente lo paga el cliente desde su cuenta de Google y no figura aquí." /><QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()}><div className="adm-grid-2">{query.data?.map(provider => <section className="adm-panel" key={provider.id}><h2>{provider.name}</h2><p>{provider.usage}</p><p>{provider.enabled ? 'Activo' : 'Desactivado'} · {formatUsd(provider.spentUsd)} de {formatUsd(provider.monthlyCapUsd)}</p><Meter value={provider.spentUsd} max={provider.monthlyCapUsd} label={`Gasto de ${provider.name}`} />{can(member.role, 'providers.edit') ? <Button onClick={() => setEditing(provider)}>Configurar</Button> : null}</section>)}</div></QueryState>{editing ? <ProviderEditor key={editing.id} provider={editing} onClose={() => setEditing(null)} /> : null}</div>;
}
function ProviderEditor({ provider, onClose }: { provider: AiProvider; onClose: () => void }) {
  const [enabled, setEnabled] = useState(provider.enabled); const [cap, setCap] = useState(String(provider.monthlyCapUsd)); const [fallback, setFallback] = useState(provider.fallback?.enabled ?? false); const update = useUpdateProvider();
  return <ReasonDialog open title={provider.name} confirmLabel="Guardar configuración" onClose={onClose} validate={() => cap.trim() && Number.isFinite(Number(cap)) && Number(cap) >= 0 ? null : 'Escribe un tope de gasto válido.'} onConfirm={reason => update.mutateAsync({ id: provider.id, patch: { enabled, monthlyCapUsd: Number(cap), fallbackEnabled: fallback, reason } })}>
    <Checkbox label="Proveedor activo" checked={enabled} onCheckedChange={setEnabled} /><Field label="Tope mensual en dólares"><Input type="number" min="0" value={cap} onChange={e => setCap(e.target.value)} /></Field>{provider.fallback ? <Checkbox label={provider.fallback.label} checked={fallback} onCheckedChange={setFallback} /> : null}
  </ReasonDialog>;
}
