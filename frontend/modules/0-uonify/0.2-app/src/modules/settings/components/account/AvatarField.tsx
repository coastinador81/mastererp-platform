import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { buttonClass, ErrorText, Hint, LinkButton, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { deleteAvatar, uploadAvatar } from '../../api/settingsApi';
import { avatarProblem } from '../../model/account';
import type { Account } from '../../model/types';
import { Avatar } from '../common';

/** Foto de la cuenta: se sube o se quita al momento (no espera a «Guardar cambios»). */
export function AvatarField({ account }: { account: Account }) {
  const client = useQueryClient();
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const setAvatar = (avatarUrl: string | null) => client.setQueryData<Account>(settingsKeys.account, current => (current ? { ...current, avatarUrl } : current));

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: ({ avatarUrl }) => {
      setAvatar(avatarUrl);
      toast.success('Foto actualizada');
    },
    onError: reason => setError(errorMessage(reason, 'No se ha podido subir la foto.')),
  });
  const remove = useMutation({
    mutationFn: deleteAvatar,
    onSuccess: () => {
      setAvatar(null);
      toast.success('Foto quitada');
    },
    onError: reason => toast.error('No se ha podido quitar la foto', { description: errorMessage(reason) }),
  });

  const onFile = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const problem = avatarProblem(file);
    setError(problem);
    if (!problem) upload.mutate(file);
  };

  const busy = upload.isPending || remove.isPending;
  return (
    <div className="uset-avatar-field">
      <Avatar src={account.avatarUrl} name={account.name} size={64} />
      <div className="uset-avatar-actions">
        <div className="pim-row">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="pim-sr-only"
            aria-describedby={hintId}
            disabled={busy}
            onChange={event => onFile(event.target.files?.[0])}
          />
          <label htmlFor={inputId} className={buttonClass('outline', 'sm', busy ? 'is-disabled' : undefined)} aria-disabled={busy || undefined}>
            {upload.isPending ? 'Subiendo…' : account.avatarUrl ? 'Cambiar foto' : 'Subir foto'}
          </label>
          {account.avatarUrl ? <LinkButton onClick={() => remove.mutate()} disabled={busy}>Quitar</LinkButton> : null}
        </div>
        <Hint id={hintId}>JPG, PNG o WEBP. Máximo 2 MB.</Hint>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
    </div>
  );
}
