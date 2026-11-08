import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsKeys } from '../api/endpoints';
import {
  getAccount,
  getAiUsage,
  getBalance,
  getBrands,
  getConnections,
  getMfa,
  getMovements,
  getPrivacy,
  getSessions,
  getSignInMethods,
  getTeam,
} from '../api/settingsApi';
import { parseBalance, parseChatGptUsage, parseMovements } from '../model/usage';

/** Lecturas de Configuración con TanStack Query (estado de servidor). */

export const useAccount = () => useQuery({ queryKey: settingsKeys.account, queryFn: ({ signal }) => getAccount(signal) });
export const useMfa = () => useQuery({ queryKey: settingsKeys.mfa, queryFn: ({ signal }) => getMfa(signal) });
export const useSessions = () => useQuery({ queryKey: settingsKeys.sessions, queryFn: ({ signal }) => getSessions(signal) });
export const useSignInMethods = () => useQuery({ queryKey: settingsKeys.signInMethods, queryFn: ({ signal }) => getSignInMethods(signal) });
export const useTeam = () => useQuery({ queryKey: settingsKeys.team, queryFn: ({ signal }) => getTeam(signal) });
export const useBrands = () => useQuery({ queryKey: settingsKeys.brands, queryFn: ({ signal }) => getBrands(signal) });

/** Conexiones (ChatGPT, Amazon, Shopify). También la pueden leer otros módulos por el index. */
export const useConnections = () => useQuery({ queryKey: settingsKeys.connections, queryFn: ({ signal }) => getConnections(signal) });

/** Mientras haya una copia de datos preparándose, se consulta cada 2 s. */
export const usePrivacy = () =>
  useQuery({
    queryKey: settingsKeys.privacy,
    queryFn: ({ signal }) => getPrivacy(signal),
    refetchInterval: query => (query.state.data?.exports.some(item => item.status === 'preparing') ? 2000 : false),
  });

/** Límites en vivo del plan de ChatGPT: se refrescan cada minuto mientras la vista está abierta. */
export function useChatGptUsage(enabled = true) {
  const query = useQuery({
    queryKey: settingsKeys.aiUsage,
    queryFn: ({ signal }) => getAiUsage(signal),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
  const usage = useMemo(() => parseChatGptUsage(query.data, query.dataUpdatedAt), [query.data, query.dataUpdatedAt]);
  return { ...query, usage };
}

/** Saldo de tokens de Uonify (GET /billing/balance, del módulo billing). */
export function useTokenBalance() {
  const query = useQuery({ queryKey: settingsKeys.balance, queryFn: ({ signal }) => getBalance(signal), retry: false });
  const balance = useMemo(() => parseBalance(query.data), [query.data]);
  return { ...query, balance };
}

/** Últimos movimientos de tokens (GET /billing/movements, del módulo billing). */
export function useTokenMovements() {
  const query = useQuery({ queryKey: settingsKeys.movements, queryFn: ({ signal }) => getMovements(signal), retry: false });
  const movements = useMemo(() => parseMovements(query.data), [query.data]);
  return { ...query, movements };
}
