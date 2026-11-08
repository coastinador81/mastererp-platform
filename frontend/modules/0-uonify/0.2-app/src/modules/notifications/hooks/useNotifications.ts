import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { toast } from '@/shared/ui';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api/notifications';
import { arrivalMessage, markReadLocally, newUnread } from '../model/inbox';
import type { NotificationsPage } from '../model/types';
import { announce } from './announcer';

/** Clave de la caché: otros módulos pueden invalidarla tras una acción que genere un aviso. */
export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;

/** La campana pregunta al backend cada minuto (hasta que llegue la entrega por /api/events). */
export const NOTIFICATIONS_POLL_MS = 60_000;

/** Opciones de la consulta: sondeo cada 60 s solo con la pestaña visible. */
export const NOTIFICATIONS_QUERY_OPTIONS = {
  refetchInterval: NOTIFICATIONS_POLL_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 30_000,
} as const;

/**
 * Notificaciones de la cuenta con sondeo cada 60 s. Cuando llega alguna nueva sin
 * leer, se anuncia a los lectores de pantalla (no en la primera carga).
 */
export function useNotifications() {
  const client = useQueryClient();
  return useQuery({
    ...NOTIFICATIONS_QUERY_OPTIONS,
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<NotificationsPage>(NOTIFICATIONS_QUERY_KEY);
      const next = await fetchNotifications(signal);
      const message = arrivalMessage(newUnread(previous, next));
      if (message) announce(message);
      return next;
    },
  });
}

interface Snapshot {
  previous: NotificationsPage | undefined;
}

/** Marca una como leída al momento y lo confirma con el backend (deshace si falla). */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation<unknown, unknown, string, Snapshot>({
    mutationFn: id => markNotificationRead(id),
    onMutate: async id => {
      await client.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previous = client.getQueryData<NotificationsPage>(NOTIFICATIONS_QUERY_KEY);
      if (previous) client.setQueryData(NOTIFICATIONS_QUERY_KEY, markReadLocally(previous, [id], new Date().toISOString()));
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) client.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
      toast.error('No se ha podido marcar como leída', { description: errorMessage(error) });
    },
    onSettled: () => client.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
}

/** Marca todas como leídas (optimista) y lo anuncia. */
export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation<unknown, unknown, void, Snapshot>({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previous = client.getQueryData<NotificationsPage>(NOTIFICATIONS_QUERY_KEY);
      if (previous) client.setQueryData(NOTIFICATIONS_QUERY_KEY, markReadLocally(previous, 'all', new Date().toISOString()));
      announce('Todas las notificaciones están marcadas como leídas');
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) client.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
      announce('');
      toast.error('No se han podido marcar como leídas', { description: errorMessage(error) });
    },
    onSettled: () => client.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
}
