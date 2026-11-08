import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/shared/api/client';
import { Button, Dialog, Field, Input, OptionTile, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { inviteMember } from '../../api/settingsApi';
import { isEmail } from '../../model/format';
import { INVITABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../model/team';
import type { InvitableRole } from '../../model/types';

/**
 * Invitar a una persona por correo con su rol. Si no quedan plazas, el backend
 * responde 402 plan_required: el cliente HTTP lo anuncia y billing abre el aviso
 * para elegir plan, así que aquí solo se cierra el diálogo.
 */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const roleLabelId = useId();

  const invite = useMutation({
    mutationFn: () => inviteMember(email.trim(), role),
    onSuccess: member => {
      void client.invalidateQueries({ queryKey: settingsKeys.team });
      toast.success('Invitación enviada', { description: `Hemos enviado un correo a ${member.email}.` });
      onClose();
    },
    onError: reason => {
      if (reason instanceof ApiError && reason.status === 402) {
        onClose();
        return;
      }
      setError(errorMessage(reason, 'No se ha podido enviar la invitación.'));
    },
  });

  // Grupo de opciones con flechas, como un grupo de botones de radio.
  const onRoleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const index = INVITABLE_ROLES.indexOf(role);
    const next = INVITABLE_ROLES[(index + step + INVITABLE_ROLES.length) % INVITABLE_ROLES.length];
    setRole(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-role="${next}"]`)?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isEmail(email)) return setError('Escribe un correo electrónico válido.');
    invite.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invitar a una persona"
      description="Le enviaremos un correo para que entre en tu espacio con su propio acceso."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="uset-invite-form" loading={invite.isPending}>Enviar invitación</Button>
        </>
      }
    >
      <form id="uset-invite-form" className="pim-stack" onSubmit={submit} noValidate>
        <Field label="Correo electrónico" error={error ?? undefined}>
          <Input type="email" autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); setError(null); }} data-autofocus="" invalid={Boolean(error)} />
        </Field>
        <div>
          <p className="pim-label" id={roleLabelId}>Rol</p>
          <div className="uset-roles" role="radiogroup" aria-labelledby={roleLabelId} onKeyDown={onRoleKey}>
            {INVITABLE_ROLES.map(value => (
              <OptionTile
                key={value}
                mode="radio"
                selected={role === value}
                tabIndex={role === value ? 0 : -1}
                data-role={value}
                title={ROLE_LABELS[value]}
                description={ROLE_DESCRIPTIONS[value]}
                onClick={() => setRole(value)}
              />
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
