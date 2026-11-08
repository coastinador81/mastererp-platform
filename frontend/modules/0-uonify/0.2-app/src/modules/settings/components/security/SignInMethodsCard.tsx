import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Badge, Button, dialog, toast, type IconName } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { linkSignInMethod, unlinkSignInMethod } from '../../api/settingsApi';
import { useSignInMethods } from '../../hooks/queries';
import { formatDate } from '../../model/format';
import { canUnlink, isAllowedAuthUrl, SIGN_IN_METHOD_LABELS } from '../../model/security';
import type { SignInMethod, SignInMethodId } from '../../model/types';
import { LoadError, Loading, SettingRow, SettingsCard } from '../common';

const METHOD_ICONS: Record<SignInMethodId, IconName> = { chatgpt: 'link', google: 'globe', email: 'uset-mail' };
const METHOD_HINTS: Record<SignInMethodId, string> = {
  chatgpt: 'Entra con tu cuenta de ChatGPT.',
  google: 'Entra con tu cuenta de Google.',
  email: 'Te enviamos un código a tu correo cada vez que entras.',
};

/** Formas de entrar vinculadas: ChatGPT, Google y correo con código (sin contraseñas). */
export function SignInMethodsCard() {
  const client = useQueryClient();
  const query = useSignInMethods();
  const setMethods = (methods: SignInMethod[]) => client.setQueryData<SignInMethod[]>(settingsKeys.signInMethods, methods);

  const link = useMutation({
    mutationFn: linkSignInMethod,
    onSuccess: (result, id) => {
      // Con el proveedor real se va a su página de autorización y vuelve a Configuración.
      if (result.authUrl) {
        if (isAllowedAuthUrl(result.authUrl)) window.location.assign(result.authUrl);
        else toast.error('No se ha podido abrir la vinculación');
        return;
      }
      if (result.methods) setMethods(result.methods);
      toast.success(`${SIGN_IN_METHOD_LABELS[id]} vinculado`);
    },
    onError: reason => toast.error('No se ha podido vincular', { description: errorMessage(reason) }),
  });
  const unlink = useMutation({
    mutationFn: unlinkSignInMethod,
    onSuccess: (result, id) => {
      setMethods(result.methods);
      toast.success(`${SIGN_IN_METHOD_LABELS[id]} desvinculado`);
    },
    onError: reason => toast.error('No se ha podido desvincular', { description: errorMessage(reason) }),
  });

  const confirmUnlink = async (id: SignInMethodId) => {
    const ok = await dialog.confirm({
      title: `¿Desvincular ${SIGN_IN_METHOD_LABELS[id]}?`,
      description: 'Ya no podrás entrar en Uonify de esta forma. Puedes volver a vincularla cuando quieras.',
      confirmLabel: 'Desvincular',
      destructive: true,
    });
    if (ok) unlink.mutate(id);
  };

  return (
    <SettingsCard title="Formas de entrar" icon="uset-key" description="Uonify no usa contraseñas. Vincula más de una forma para no quedarte sin acceso.">
      {query.isPending ? <Loading /> : null}
      {query.isError ? <LoadError error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <ul className="uset-rows" aria-label="Formas de entrar">
          {query.data.map(method => {
            const label = SIGN_IN_METHOD_LABELS[method.id];
            const removable = canUnlink(query.data, method.id);
            return (
              <li key={method.id}>
                <SettingRow
                  icon={METHOD_ICONS[method.id]}
                  title={label}
                  badge={method.linked ? <Badge tone="green">Vinculado</Badge> : undefined}
                  description={method.linked ? `${method.email ?? ''} · desde el ${formatDate(method.linkedAt)}` : METHOD_HINTS[method.id]}
                  actions={method.linked ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { if (removable) void confirmUnlink(method.id); }}
                      aria-disabled={!removable || unlink.isPending || undefined}
                      disabled={unlink.isPending}
                      tooltip={removable ? undefined : 'Necesitas al menos una forma de entrar'}
                      tooltipPos="below"
                      tooltipAlign="end"
                      aria-label={`Desvincular ${label}`}
                    >
                      Desvincular
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => link.mutate(method.id)} loading={link.isPending && link.variables === method.id} aria-label={`Vincular ${label}`}>
                      Vincular
                    </Button>
                  )}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </SettingsCard>
  );
}
