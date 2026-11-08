import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Badge, Button, dialog, toast } from '@/shared/ui';
import { signOut } from '@/modules/auth';
import { settingsKeys } from '../../api/endpoints';
import { endAllSessions, endSession } from '../../api/settingsApi';
import { useSessions } from '../../hooks/queries';
import { formatRelative } from '../../model/format';
import { sessionLabel, SIGN_IN_METHOD_LABELS } from '../../model/security';
import type { ActiveSession } from '../../model/types';
import { LoadError, Loading, SettingRow, SettingsCard } from '../common';

/** Sesiones abiertas: cerrar una concreta o todas (también la de este dispositivo). */
export function SessionsCard() {
  const client = useQueryClient();
  const query = useSessions();

  const endOne = useMutation({
    mutationFn: (session: ActiveSession) => endSession(session.id),
    onSuccess: (_result, session) => {
      client.setQueryData<ActiveSession[]>(settingsKeys.sessions, current => current?.filter(item => item.id !== session.id));
      toast.success('Sesión cerrada', { description: sessionLabel(session) });
    },
    onError: reason => toast.error('No se ha podido cerrar la sesión', { description: errorMessage(reason) }),
  });
  const endAll = useMutation({
    mutationFn: endAllSessions,
    onSuccess: () => {
      toast.success('Sesiones cerradas en todos tus dispositivos');
      // Esta también se ha cerrado: se sale de Uonify.
      void signOut();
    },
    onError: reason => toast.error('No se han podido cerrar las sesiones', { description: errorMessage(reason) }),
  });

  const confirmOne = async (session: ActiveSession) => {
    const ok = await dialog.confirm({
      title: '¿Cerrar esta sesión?',
      description: `${sessionLabel(session)} · ${session.location}. Tendrá que volver a entrar en ese dispositivo.`,
      confirmLabel: 'Cerrar sesión',
      destructive: true,
    });
    if (ok) endOne.mutate(session);
  };

  const confirmAll = async () => {
    const ok = await dialog.confirm({
      title: '¿Cerrar todas las sesiones?',
      description: 'Se cerrarán en todos tus dispositivos, también en este. Tendrás que volver a entrar.',
      confirmLabel: 'Cerrar todas',
      destructive: true,
    });
    if (ok) endAll.mutate();
  };

  return (
    <SettingsCard
      title="Sesiones abiertas"
      icon="uset-monitor"
      description="Dispositivos en los que has entrado en Uonify. Si no reconoces alguno, ciérralo."
      actions={query.data?.length ? <Button size="sm" onClick={() => void confirmAll()} loading={endAll.isPending}>Cerrar todas</Button> : undefined}
    >
      {query.isPending ? <Loading /> : null}
      {query.isError ? <LoadError error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <ul className="uset-rows" aria-label="Sesiones abiertas">
          {[...query.data].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)).map(session => (
            <li key={session.id}>
              <SettingRow
                icon={session.device === 'desktop' ? 'uset-monitor' : 'uset-phone'}
                title={sessionLabel(session)}
                badge={session.current ? <Badge tone="blue">Esta sesión</Badge> : undefined}
                description={`${session.location} · ${session.current ? 'Activa ahora' : `Última actividad ${formatRelative(session.lastActiveAt)}`} · Entró con ${SIGN_IN_METHOD_LABELS[session.signInMethod]}`}
                actions={session.current ? undefined : (
                  <Button size="sm" onClick={() => void confirmOne(session)} disabled={endOne.isPending} aria-label={`Cerrar la sesión de ${sessionLabel(session)} en ${session.location}`}>
                    Cerrar esta
                  </Button>
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsCard>
  );
}
