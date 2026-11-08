import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Select, dialog, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { changeRole, removeMember, resendInvitation } from '../../api/settingsApi';
import { settingsKeys } from '../../api/endpoints';
import { useTeam } from '../../hooks/queries';
import { canManageTeam, ROLE_LABELS, seatsLabel, sortMembers } from '../../model/team';
import { Loading, LoadError, SettingsCard, SettingRow } from '../common';
import { InviteDialog } from './InviteDialog';

export function TeamSection() {
  const query = useTeam();
  const client = useQueryClient();
  const [invite, setInvite] = useState(false);
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { void client.invalidateQueries({ queryKey: settingsKeys.team }); toast.success('Usuarios actualizados'); },
    onError: error => toast.error(errorMessage(error)),
  });
  if (query.isPending) return <Loading />;
  if (!query.data) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  const team = query.data;
  const manage = canManageTeam(team.members.find(m => m.id === team.youId)?.role);
  return <SettingsCard title={seatsLabel(team)} description={`Plan ${team.planName}. Las invitaciones también ocupan una plaza.`}
    actions={manage ? <Button variant="primary" onClick={() => setInvite(true)}>Invitar</Button> : null}>
    {sortMembers(team.members).map(member => <SettingRow key={member.id} title={member.name || member.email}
      description={`${member.email} · ${member.status === 'invited' ? 'Invitación enviada' : ROLE_LABELS[member.role]}`}
      actions={manage && member.role !== 'owner' && member.id !== team.youId ? <>
        <Select aria-label={`Rol de ${member.email}`} value={member.role} disabled={action.isPending}
          onChange={e => action.mutate(() => changeRole(member.id, e.target.value === 'admin' ? 'admin' : 'editor'))}>
          <option value="admin">Administrador</option><option value="editor">Editor</option>
        </Select>
        {member.status === 'invited' ? <Button disabled={action.isPending} onClick={() => action.mutate(() => resendInvitation(member.id))}>Reenviar</Button> : null}
        <Button disabled={action.isPending} onClick={async () => {
          if (await dialog.confirm({ title: 'Quitar acceso', description: `${member.email} dejará de acceder a este espacio.`, confirmLabel: 'Quitar acceso' })) action.mutate(() => removeMember(member.id));
        }}>Quitar</Button>
      </> : null} />)}
    {invite ? <InviteDialog onClose={() => setInvite(false)} /> : null}
  </SettingsCard>;
}
