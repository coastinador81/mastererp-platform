import { errorMessage } from '@/shared/api/client';
import { download } from '@/shared/lib';
import { toast } from '@/shared/ui';
import { billingApi } from '../api/billingApi';
import type { BillingDocument } from '../model/types';

const NAMES: Record<BillingDocument['kind'], string> = {
  invoice: 'la factura',
  credit_note: 'la nota de crédito',
  corrective: 'la factura rectificativa',
};

/** Descarga el PDF de una factura, nota de crédito o rectificativa. */
export async function downloadDocument(doc: Pick<BillingDocument, 'id' | 'number' | 'kind'>): Promise<boolean> {
  try {
    const blob = await billingApi.invoicePdf(doc.id);
    const url = URL.createObjectURL(blob);
    download(url, `${doc.number}.pdf`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch (error) {
    toast.error(`No se ha podido descargar ${NAMES[doc.kind]} ${doc.number}`, { description: errorMessage(error) });
    return false;
  }
}

export function documentTitle(doc: Pick<BillingDocument, 'kind' | 'number'>): string {
  const title = doc.kind === 'invoice' ? 'Factura' : doc.kind === 'credit_note' ? 'Nota de crédito' : 'Factura rectificativa';
  return `${title} ${doc.number}`;
}
