import { Icon } from '@/shared/ui';
import { startChatGPT, startGoogle } from '../flows/access';
import { openEmailView } from '../flows/email';
import { useAuthConfig, useProviders } from '../hooks/useAuthConfig';
import { useAuthUi } from '../state/authUi';
import { BRAND, GoogleMark } from './brand';

/**
 * Las tres formas de entrar. «Continuar con ChatGPT» es el único botón sólido
 * (texto exacto que pide OpenAI); Google y el correo van con contorno.
 */
export function SignInProviders() {
  const { prompt, status, providerDisabled } = useAuthUi(state => state.signIn);
  const providers = useProviders();
  const config = useAuthConfig();

  return (
    <>
      <div className="uon-auth-pending" id="uon-auth-pending" hidden={!prompt}>
        <span>Tu petición está lista</span>
        <p id="uon-auth-prompt">{prompt}</p>
      </div>
      <div className="uon-auth-providers">
        {providers.includes('chatgpt') ? (
          <button
            className="uon-auth-provider"
            type="button"
            data-auth-provider="chatgpt"
            disabled={providerDisabled}
            onClick={() => void startChatGPT()}
          >
            <img className="uon-auth-chatgpt-mark" src={BRAND.chatgpt} width={29} height={29} alt="" />
            <span>Continuar con ChatGPT</span>
            <span className="uon-auth-provider-arrow" aria-hidden="true">→</span>
          </button>
        ) : null}
        {providers.includes('google') ? (
          <button
            className={providers.includes('chatgpt') ? 'uon-auth-provider is-secondary' : 'uon-auth-provider'}
            type="button"
            data-auth-provider="google"
            disabled={providerDisabled}
            onClick={() => void startGoogle()}
          >
            <span className="uon-auth-provider-mark">
              <GoogleMark />
            </span>
            <span>Continuar con Google</span>
            <span className="uon-auth-provider-arrow" aria-hidden="true">→</span>
          </button>
        ) : null}
        {providers.includes('email') ? (
          <button className="uon-auth-provider is-secondary" type="button" data-auth-provider="email" disabled={providerDisabled} onClick={openEmailView}>
            <span className="uon-auth-provider-mark">
              <Icon name="auth-mail" size={20} />
            </span>
            <span>Continuar con tu correo</span>
            <span className="uon-auth-provider-arrow" aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
      <p className="uon-auth-help">
        {providers.length === 1 && providers[0] === 'google'
          ? 'Google confirma tu nombre y tu correo. Tu contraseña permanece en Google. Conectar Drive o Gemini requerirá otro permiso.'
          : 'Con ChatGPT o Google, Uonify solo recibe tu nombre, tu correo y tu foto de perfil. Nunca ve tu contraseña ni tus conversaciones.'}
      </p>
      {config?.ready === false && !status ? <p className="uon-auth-status" role="status">El acceso con Google aún no está disponible. Inténtalo más tarde.</p> : null}
      <p className="uon-auth-status" id="uon-auth-status" role="status" hidden={!status}>
        {status}
      </p>
    </>
  );
}
