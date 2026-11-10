/**
 * Sugerencias de compras de la demo del equipo (2.2-finance/src/local/
 * PurchaseSuggestionsPreview.jsx y suggestionReview.mjs): tres propuestas fijas de
 * reposición por stock y las reglas de sus dos revisiones (Jefe de nodo y Jefe de compras).
 * Sin IA, sin algoritmo y sin permisos reales: todo es de ejemplo y vive en la pestaña.
 */
import { money, type NodeId } from './demoPurchases';

export interface Suggestion {
  id: string;
  node: NodeId;
  product: string;
  supplier: string;
  stock: number;
  quantity: number;
  price: number;
}

export const SUGGESTIONS: readonly Suggestion[] = [
  { id: '001', node: 'a', product: 'Papel para oficina DEMO', supplier: 'Suministros Horizonte DEMO', stock: 4, quantity: 20, price: 150 },
  { id: '002', node: 'b', product: 'Cajas para despacho DEMO', supplier: 'Empaques Río Claro DEMO', stock: 12, quantity: 100, price: 85 },
  { id: '003', node: 'c', product: 'Insumos de limpieza DEMO', supplier: 'Limpieza Brisa DEMO', stock: 3, quantity: 15, price: 240 },
];

export const suggestionReference = (suggestion: Pick<Suggestion, 'id'>): string => `DEMO-SUG-${suggestion.id}`;
export const findSuggestion = (reference: string | undefined): Suggestion | null =>
  SUGGESTIONS.find(item => suggestionReference(item) === reference) ?? null;

/** Lo que se escribe en el editor (texto, como los campos). */
export interface ProposalDraft {
  quantity: string;
  price: string;
  supplier: string;
  priority?: boolean;
  purchasingNote?: string;
}

/** Una propuesta ya validada (números). */
export interface Proposal {
  quantity: number;
  price: number;
  supplier: string;
}

type Valued = { quantity: number | string; price: number | string; supplier: string };

export const proposalOf = (value: Valued): ProposalDraft => ({ quantity: String(value.quantity), price: String(value.price), supplier: value.supplier });

export function validateProposal(value: ProposalDraft): string {
  if (!/^\d+$/.test(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 1000000) return 'La cantidad debe ser un número entero entre 1 y 1.000.000.';
  if (!/^\d+(\.\d{1,2})?$/.test(value.price) || Number(value.price) <= 0 || Number(value.price) > 1000000) return 'Indica un precio positivo de hasta 1.000.000, con un máximo de dos decimales.';
  if (!value.supplier.trim() || value.supplier.trim().length > 160) return 'Indica un proveedor de hasta 160 caracteres.';
  return '';
}

export const cleanProposal = (value: ProposalDraft): Proposal => ({ quantity: Number(value.quantity), price: Number(value.price), supplier: value.supplier.trim() });
export const totalOf = (value: { quantity: number | string; price: number | string }): number => Number(value.quantity) * Math.round(Number(value.price) * 100) / 100;
export const changedProposal = (a: Valued, b: Valued): boolean =>
  Number(a.quantity) !== Number(b.quantity) || Number(a.price) !== Number(b.price) || a.supplier.trim() !== b.supplier.trim();

/** Importes de las sugerencias: siempre en bolívares, como la demo. */
export const bolivares = (value: number): string => `Bs. ${money(value)}`;

export type Stage = 'node' | 'purchasing' | 'completed';

/** Etapas del filtro «Aprobación» de la demo. */
export const STAGE_OPTIONS: ReadonlyArray<{ value: Stage; label: string }> = [
  { value: 'node', label: 'Pendiente de revisión del nodo' },
  { value: 'purchasing', label: 'Pendiente del Jefe de compras' },
  { value: 'completed', label: 'Aprobada · pasada a Compras' },
];

export const stageLabel = (stage: Stage): string => STAGE_OPTIONS.find(option => option.value === stage)?.label ?? '';

/** Fecha y hora local del navegador con segundos (ReviewTime.jsx), o «Pendiente». */
export const reviewTime = (value: string | undefined): string =>
  value ? new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Pendiente';
