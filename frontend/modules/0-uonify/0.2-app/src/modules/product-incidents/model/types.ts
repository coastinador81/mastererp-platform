export type IncidentStatus = 'needs_attention' | 'correction_ready' | 'awaiting_amazon' | 'resolved';
export type IncidentSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface ProductIncident {
  id: string;
  sku: string;
  productId: string | null;
  productName: string;
  marketplaceId: string;
  marketplaceName: string;
  code: string;
  message: string;
  severity: IncidentSeverity;
  attributeNames: string[];
  status: IncidentStatus;
  revision: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  history: { at: string; event: string; message: string }[];
  submissionStatus: 'accepted' | 'unknown' | 'rejected' | null;
}

export interface IncidentList {
  incidents: ProductIncident[];
  summary: { active: number; products: number; blocking: number; warnings: number };
  sync: {
    state: 'never' | 'ok' | 'partial' | 'error';
    lastCheckedAt: string | null;
    message: string | null;
    nextToken: string | null;
    marketplaceId?: string;
    marketplaceName?: string;
  };
  connection: { connected: boolean; marketplaceId: string; sellerId?: string; marketplaces?: { id: string; name: string }[] };
}

export interface IncidentFilters {
  sku?: string;
  status?: 'active' | 'resolved' | 'all';
  marketplaceId?: string;
}

export const INCIDENT_STATUS: Record<IncidentStatus, string> = {
  needs_attention: 'Requiere corrección',
  correction_ready: 'Corrección preparada',
  awaiting_amazon: 'Pendiente de confirmación',
  resolved: 'Resuelta',
};

export const INCIDENT_SEVERITY: Record<IncidentSeverity, string> = {
  ERROR: 'Error', WARNING: 'Advertencia', INFO: 'Información',
};

export function incidentDate(value: string | null): string {
  if (!value) return 'Sin comprobar';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function filterIncidents(incidents: ProductIncident[], search: string, severity: string, status: string, market: string): ProductIncident[] {
  const term = search.trim().toLocaleLowerCase('es');
  return incidents.filter(item => (!term || `${item.productName} ${item.sku} ${item.message}`.toLocaleLowerCase('es').includes(term))
    && (!severity || item.severity === severity) && (!status || item.status === status) && (!market || item.marketplaceId === market));
}
