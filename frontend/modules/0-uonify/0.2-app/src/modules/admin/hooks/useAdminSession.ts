import { createContext, useContext, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { adminAuthApi } from '../api/adminApi';
import type { AdminSession, TeamMember } from '../model/types';

/**
 * Consultas de /api/admin/* (empiezan por «admin») y de billing y help desde el panel
 * («admin-ext»). Solo un 401 de las primeras cierra la sesión del panel.
 */
export const ADMIN_KEY = 'admin';
export const EXTERNAL_KEY = 'admin-ext';
/** Marca de las mutaciones de /api/admin/* (su 401 también cierra la sesión). */
export const ADMIN_META = { admin: true } as const;
export const SESSION_KEY = [ADMIN_KEY, 'session'] as const;

export function useAdminSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: adminAuthApi.session, staleTime: 60_000, retry: false });
}

/** Tras entrar: guarda la sesión y descarta datos de una sesión anterior. */
export function useSignedIn() {
  const client = useQueryClient();
  return (session: AdminSession) => {
    client.removeQueries({ predicate: query => (query.queryKey[0] === ADMIN_KEY && query.queryKey[1] !== 'session') || query.queryKey[0] === EXTERNAL_KEY });
    client.setQueryData(SESSION_KEY, session);
  };
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminAuthApi.logout,
    onSettled: () => {
      // Se borran los datos del panel pero NO la consulta de sesión: si se quita a la
      // vez que se fija su valor, el observador no refleja el cierre y la vista se queda
      // en el panel. Igual que useSignedIn, se conserva la sesión y se marca sin sesión.
      client.removeQueries({ predicate: query => (query.queryKey[0] === ADMIN_KEY && query.queryKey[1] !== 'session') || query.queryKey[0] === EXTERNAL_KEY });
      client.setQueryData<AdminSession>(SESSION_KEY, { authenticated: false });
    },
  });
}

/**
 * Un 401 del panel puede ser la sesión caducada o una sección aún no construida (el
 * backend responde 401 a lo que todavía no existe). Para no echar al equipo por una
 * sección no disponible: si el 401 viene de la propia sesión, se vuelve al acceso;
 * si viene de otra consulta, se re-comprueba la sesión y solo se cierra si ya no vale.
 */
export function useSessionExpiry(): void {
  const client = useQueryClient();
  useEffect(() => {
    const handle = (isSession: boolean, error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 401) return;
      if (isSession) {
        client.setQueryData<AdminSession>(SESSION_KEY, { authenticated: false });
      } else {
        void client.invalidateQueries({ queryKey: SESSION_KEY });
      }
    };
    const offQueries = client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'error' && event.query.queryKey[0] === ADMIN_KEY) {
        handle(event.query.queryKey[1] === 'session', event.action.error);
      }
    });
    const offMutations = client.getMutationCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'error' && event.mutation.options.meta?.admin === true) handle(false, event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [client]);
}

/** Miembro del equipo con la sesión abierta (lo da <AdminLayout/>). */
export const AdminMemberContext = createContext<TeamMember | null>(null);

export function useAdminMember(): TeamMember {
  const member = useContext(AdminMemberContext);
  if (!member) throw new Error('useAdminMember necesita la sesión del panel.');
  return member;
}
