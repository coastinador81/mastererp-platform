import { api, ApiError } from '@/shared/api/client';
import type { IncidentFilters, IncidentList, ProductIncident } from '../model/types';

function checkedList(value: IncidentList): IncidentList {
  if (!value || !Array.isArray(value.incidents) || !value.summary || typeof value.summary.active !== 'number' || !value.sync || !value.connection) {
    throw new ApiError(502, { message: 'No se ha podido leer el estado de las incidencias. Vuelve a comprobarlo.' });
  }
  return value;
}

export const listIncidents = async (filters: IncidentFilters, signal?: AbortSignal) =>
  checkedList(await api.get<IncidentList>('/product-incidents', { params: { ...filters }, signal }));

export const getIncident = (id: string, signal?: AbortSignal) =>
  api.get<{ incident: ProductIncident }>(`/product-incidents/${encodeURIComponent(id)}`, { signal });

export const syncIncidents = async (filters: Pick<IncidentFilters, 'sku' | 'marketplaceId'>, cursor?: string) =>
  checkedList(await api.post<IncidentList>('/product-incidents/sync', { ...filters, ...(cursor ? { cursor } : {}) }));
