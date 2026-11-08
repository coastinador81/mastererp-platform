import { type RefObject } from 'react';
import { openConversationActivation, openSignIn, useSession } from '@/modules/auth';
import { useGoogleOptions, useGooglePreferences, saveGooglePreferences } from '../../hooks/googlePreferences';
import { useComposerStore } from '../../hooks/composerStore';
import { useUiStore } from '../../hooks/uiStore';
import { GoogleAiControls } from './GoogleAiControls';
import { ChevronDownIcon } from '../ShellIcons';

export function GoogleAiPicker({ form, onSignIn }: { form: RefObject<HTMLFormElement | null>; onSignIn?: () => void }) {
  const { user } = useSession();
  if (user?.email) return <AuthenticatedGoogleAiPicker key={user.email} account={user.email} form={form} />;
  const access = () => {
    if (onSignIn) onSignIn();
    else void openSignIn({ prompt: useComposerStore.getState().draft.trim() });
  };
  return <div className="composer-ai-picker">
    <button type="button" className="composer-speed-trigger" aria-label="Respuesta ágil: iniciar sesión" onClick={access}><span className="composer-ai-bolt" aria-hidden="true">ϟ</span></button>
    <button type="button" className="composer-model-trigger composer-ai-trigger" aria-label="Modelo: Auto. Razonamiento: Medio. Iniciar sesión" onClick={access}><span>Auto · Medio</span><ChevronDownIcon className="composer-ai-chevron" /></button>
  </div>;
}

function AuthenticatedGoogleAiPicker({ form, account }: { form: RefObject<HTMLFormElement | null>; account: string }) {
  const query = useGoogleOptions();
  const selection = useGooglePreferences();
  const data = selection.account === account ? selection.data : null;
  const saving = selection.account === account && selection.saving;
  const pending = useUiStore(state => Boolean(state.pendingReply));
  if (!data?.models.length || query.isError) return <div className="composer-ai-picker composer-ai-unavailable">
    <button type="button" className="composer-model-trigger composer-ai-setup" disabled={query.isFetching}
      aria-label={query.isError ? 'Reintentar carga de modelos' : query.isLoading ? 'Comprobando modelos de IA' : 'Configurar IA en esta conversación'}
      data-tooltip={query.isError ? 'No se pudieron cargar los modelos. Reintentar.' : 'Configura Google sin salir de tu conversación.'}
      onClick={() => { useComposerStore.getState().setPicker(null); if (query.isError) void query.refetch(); else openConversationActivation(); }}>
      {query.isLoading ? 'Cargando IA…' : query.isError ? 'Reintentar IA' : 'Configurar IA'}
    </button>
  </div>;
  return <GoogleAiControls form={form} data={data} preferences={data.preferences}
    enabled={!saving && !pending && !query.isFetching} choose={saveGooglePreferences} />;
}
