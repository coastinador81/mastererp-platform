import type { FormEvent } from 'react';
import { backToSignIn, cancelConnect, submitIdentity } from '../flows/access';
import { EMAIL_MAX_LENGTH } from '../model/profile';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { patchConnect, useAuthUi } from '../state/authUi';
import { BRAND } from './brand';


/**
 * Modo demostración del acceso con ChatGPT o Google (prototipo: #uon-connect-dialog).
 * Solo existe con el backend en modo «preview». Requisito de la revisión de OpenAI:
 * no imita la pantalla del proveedor (sin su logotipo).
 */
export function ConnectDialog() {
  const open = useAuthUi(state => state.dialog === 'connect');
  const { email, submitting, provider } = useAuthUi(state => state.connect);
  const { ref, onKeyDown } = useNativeDialog(open, cancelConnect);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void submitIdentity(email);
  };

  return (
    <dialog
      ref={ref}
      id="uon-connect-dialog"
      className="uon-connect-dialog"
      aria-labelledby="uon-connect-title"
      aria-describedby="uon-connect-intro"
      data-provider={provider}
      onKeyDown={onKeyDown}
    >
      <div className="uon-connect-card">
        <button className="uon-auth-close" type="button" data-connect-close aria-label="Volver al inicio de sesión" onClick={backToSignIn}>
          ×
        </button>
        <div className="uon-connect-brands" aria-hidden="true">
          <span className="uon-connect-uonify">
            <img data-uonify-logo="relief" src={BRAND.isotype} width={58} height={36} alt="" />
          </span>
        </div>
        
        <p className="uon-auth-overline">TU ESPACIO UONIFY</p>
        <h2 id="uon-connect-title">Continúa en Uonify</h2>
        <p id="uon-connect-intro">
          Escribe tu correo para continuar.
        </p>
        <form id="uon-connect-form" onSubmit={onSubmit}>
          <label htmlFor="uon-connect-email">Correo electrónico</label>
          <input
            id="uon-connect-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={EMAIL_MAX_LENGTH}
            placeholder="nombre@empresa.com"
            required
            value={email}
            onChange={event => patchConnect({ email: event.target.value })}
          />
          <div className="uon-connect-detail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="5" y="10" width="14" height="11" rx="3" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </svg>
            <p>Uonify nunca te pedirá la contraseña de tu correo.</p>
          </div>
          <button className="uon-connect-continue" type="submit" disabled={submitting}>
            Continuar <span aria-hidden="true">→</span>
          </button>
        </form>
        <button className="uon-connect-back" type="button" data-connect-close onClick={backToSignIn}>
          Volver
        </button>
      </div>
    </dialog>
  );
}
