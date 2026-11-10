import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FinanceCollection, Page } from '../api/finance';
import { MastererpError } from '../api/errors';
import { liveList, liveRecord } from '../api/live';
import { readyScope, useMastererp } from './useMastererp';

/** Mensaje por código HTTP: cada pantalla pasa los textos de su pantalla del equipo. */
export type Messages = Partial<Record<number, string>> & { fallback: string };

export const messageFor = (error: unknown, messages: Messages): string =>
  error instanceof MastererpError ? messages[error.status] ?? messages.fallback : messages.fallback;

/** Claves de caché de los datos reales de Finanzas (por espacio y empresa). */
export const erpKeys = {
  page: (collection: FinanceCollection, tenant: string, company: string, cursor: string, q: string) => ['erp', collection, tenant, company, 'page', cursor, q] as const,
  record: (collection: FinanceCollection, tenant: string, company: string, id: string) => ['erp', collection, tenant, company, 'record', id] as const,
};

// Datos de una empresa: nunca se reintenta a ciegas un 401/403/404 (la API ya decidió).
const retry = (count: number, error: unknown) => !(error instanceof MastererpError && error.status < 500) && count < 1;

const statusOf = (error: unknown): number | null => (error instanceof MastererpError ? error.status : null);

export interface RealPage<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: T[];
  error: string | null;
  /** Código HTTP del fallo (401, 403…), para decidir si se ofrece reintentar. */
  errorStatus: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
  next: () => void;
  previous: () => void;
  reload: () => void;
}

/**
 * Una página de una colección real de Finanzas, con la paginación por cursor de la API
 * (10 por página, como las pantallas del equipo). TanStack Query cancela la petición al
 * cambiar de espacio, empresa o página. Sin conexión lista, no pide nada.
 */
export function useRealPage<T>(collection: FinanceCollection, messages: Messages, q = ''): RealPage<T> {
  // Valores simples: un objeto nuevo en cada lectura del estado repintaría sin fin.
  const tenant = useMastererp(state => readyScope(state)?.tenant ?? '');
  const company = useMastererp(state => readyScope(state)?.company ?? '');
  const [cursor, setCursor] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  // Una búsqueda nueva vuelve a la primera página (derivado al pintar, sin efecto).
  const [searched, setSearched] = useState(q);
  if (searched !== q) {
    setSearched(q);
    setCursor('');
    setPages([]);
  }
  const query = useQuery<Page<T>>({
    queryKey: erpKeys.page(collection, tenant, company, cursor, q),
    // Siempre a través del servidor de Uonify, que custodia la cuenta del ERP.
    queryFn: ({ signal }) => liveList<T>(collection, { after: cursor || undefined, limit: 10, q, signal }),
    enabled: Boolean(tenant && company),
    retry,
    staleTime: 30_000,
  });
  const status: RealPage<T>['status'] = !tenant || !company ? 'idle' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready';
  const nextCursor = query.data?.nextCursor ?? null;
  return {
    status,
    items: query.data?.items ?? [],
    error: query.isError ? messageFor(query.error, messages) : null,
    errorStatus: query.isError ? statusOf(query.error) : null,
    hasPrevious: pages.length > 0,
    hasNext: Boolean(nextCursor),
    next: () => {
      if (!nextCursor) return;
      setPages(current => [...current, cursor]);
      setCursor(nextCursor);
    },
    previous: () => {
      setCursor(pages.at(-1) ?? '');
      setPages(current => current.slice(0, -1));
    },
    reload: () => void query.refetch(),
  };
}

export interface RealRecord<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  errorStatus: number | null;
  reload: () => void;
}

/** Una ficha real de Finanzas por su referencia opaca (GET /api/erp/<tipo>/<referencia>). */
export function useRealRecord<T>(collection: FinanceCollection, id: string | null, messages: Messages): RealRecord<T> {
  // Valores simples: un objeto nuevo en cada lectura del estado repintaría sin fin.
  const tenant = useMastererp(state => readyScope(state)?.tenant ?? '');
  const company = useMastererp(state => readyScope(state)?.company ?? '');
  const query = useQuery<T>({
    queryKey: erpKeys.record(collection, tenant, company, id ?? ''),
    queryFn: ({ signal }) => liveRecord<T>(collection, id ?? '', signal),
    enabled: Boolean(tenant && company && id),
    retry,
    staleTime: 30_000,
  });
  const status: RealRecord<T>['status'] = !tenant || !company || !id ? 'idle' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready';
  return {
    status,
    data: query.data ?? null,
    error: query.isError ? messageFor(query.error, messages) : null,
    errorStatus: query.isError ? statusOf(query.error) : null,
    reload: () => void query.refetch(),
  };
}
