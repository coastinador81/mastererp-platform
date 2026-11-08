import { useState } from 'react';
import { Field, Input, Select } from '@/shared/ui';
import type { AdjustmentCategory, AdminRole, CustomerDetail, SuspendReason } from '../../model/types';
import { ReasonDialog } from '../common/ReasonDialog';

type CloseProps = { open: boolean; onClose: () => void };
/** El importe se escribe en € y se guarda en céntimos (100 = 1 €), como el backend. */
const euros = (value: string) => Number(value.replace(',', '.'));
export function AdjustBalanceDialog({ open, customer, onClose, onConfirm }: CloseProps & { customer: CustomerDetail; role: AdminRole; onConfirm: (input: { tokens: number; category: AdjustmentCategory; reason: string }) => Promise<unknown> }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<AdjustmentCategory>('correccion');
  const value = euros(amount);
  return <ReasonDialog open={open} title={`Ajuste de cuenta · ${customer.company}`} description="Importe en €. Usa un negativo para restar. Un ajuste de cortesía amplía el acceso; los superiores a 100 € requieren otra aprobación." confirmLabel="Registrar ajuste" onClose={onClose}
    validate={() => !Number.isFinite(value) || value === 0 ? 'Escribe un importe en euros distinto de cero.' : null}
    onConfirm={reason => onConfirm({ tokens: Math.round(value * 100), category, reason })}>
    <Field label="Importe (€)"><Input value={amount} inputMode="decimal" placeholder="9,90" onChange={e => setAmount(e.target.value)} /></Field>
    <Field label="Tipo de ajuste"><Select value={category} onChange={e => setCategory(e.target.value as AdjustmentCategory)}><option value="correccion">Corrección</option><option value="compensacion">Compensación</option><option value="cortesia">Cortesía</option></Select></Field>
  </ReasonDialog>;
}
export function SuspendDialog({ open, mode, company, onClose, onSuspend, onReactivate }: CloseProps & { mode: 'suspend' | 'reactivate'; company: string; onSuspend: (input: { category: SuspendReason; reason: string }) => Promise<unknown>; onReactivate: (reason: string) => Promise<unknown> }) {
  const [category, setCategory] = useState<SuspendReason>('otro');
  return <ReasonDialog open={open} title={`${mode === 'suspend' ? 'Suspender' : 'Reactivar'} · ${company}`} confirmLabel={mode === 'suspend' ? 'Suspender cuenta' : 'Reactivar cuenta'} onClose={onClose} onConfirm={reason => mode === 'suspend' ? onSuspend({ category, reason }) : onReactivate(reason)}>
    {mode === 'suspend' ? <Field label="Causa"><Select value={category} onChange={e => setCategory(e.target.value as SuspendReason)}><option value="impago">Impago</option><option value="abuso">Abuso</option><option value="peticion_cliente">Petición del cliente</option><option value="otro">Otro motivo</option></Select></Field> : null}
  </ReasonDialog>;
}
export function AiBlockDialog({ open, blocked, company, onClose, onConfirm }: CloseProps & { blocked: boolean; company: string; onConfirm: (reason: string) => Promise<unknown> }) {
  return <ReasonDialog open={open} title={`${blocked ? 'Devolver' : 'Cortar'} la IA · ${company}`} description="El resto del espacio seguirá disponible." confirmLabel={blocked ? 'Devolver la IA' : 'Cortar la IA'} onClose={onClose} onConfirm={onConfirm} />;
}
