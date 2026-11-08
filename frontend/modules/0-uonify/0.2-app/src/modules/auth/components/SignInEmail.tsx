import type { FormEvent } from 'react';
import { backToProviders, changeEmail, sendEmailCode, setEmailCode, verifyCode } from '../flows/email';
import { useCountdown } from '../hooks/useCountdown';
import { CODE_LENGTH, formatCountdown } from '../model/emailCode';
import { EMAIL_MAX_LENGTH } from '../model/profile';
import { patchSignIn, useAuthUi } from '../state/authUi';

/** Paso 1 del correo: la dirección a la que enviar el código. */
export function SignInEmail() {
  const { email, busy, error } = useAuthUi(state => state.signIn);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendEmailCode();
  };

  return (
    <>
      <form id="uon-auth-email-form" className="uon-auth-form" noValidate onSubmit={onSubmit}>
        <label htmlFor="uon-auth-email">Correo electrónico</label>
        <input
          id="uon-auth-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={EMAIL_MAX_LENGTH}
          placeholder="nombre@empresa.com"
          required
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'uon-auth-email-error' : undefined}
          onChange={event => patchSignIn({ email: event.target.value, error: '' })}
        />
        <p className="uon-auth-error" id="uon-auth-email-error" role="alert" hidden={!error}>
          {error}
        </p>
        <button className="uon-auth-submit" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Enviando el código…' : 'Enviar código'}
        </button>
      </form>
      <button className="uon-auth-back" type="button" onClick={backToProviders}>
        Volver
      </button>
    </>
  );
}

/** Paso 2 del correo: el código de 6 dígitos, con reenvío a los 30 s. */
export function SignInCode() {
  const { code, busy, error, resendAt, previewCode, codeDead } = useAuthUi(state => state.signIn);
  const wait = useCountdown(resendAt);
  const describedBy = ['uon-auth-code-help', error ? 'uon-auth-code-error' : ''].filter(Boolean).join(' ');

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void verifyCode();
  };

  return (
    <>
      <form id="uon-auth-code-form" className="uon-auth-form" noValidate onSubmit={onSubmit}>
        <label htmlFor="uon-auth-code">Código de verificación</label>
        <input
          id="uon-auth-code"
          className="uon-auth-code-input"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          size={CODE_LENGTH + 2}
          placeholder="000000"
          value={code}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={event => setEmailCode(event.target.value)}
        />
        <p className="uon-auth-hint" id="uon-auth-code-help">
          Escribe los 6 dígitos. Si no lo encuentras, revisa la carpeta de correo no deseado.
        </p>
        {previewCode ? (
          <p className="uon-auth-preview-code">
            
            <span>
              Tu código es <strong>{previewCode}</strong>.
            </span>
          </p>
        ) : null}
        <p className="uon-auth-error" id="uon-auth-code-error" role="alert" hidden={!error}>
          {error}
        </p>
        <button className="uon-auth-submit" type="submit" disabled={busy || codeDead} aria-busy={busy || undefined}>
          {busy ? 'Comprobando…' : 'Verificar'}
        </button>
      </form>
      <div className="uon-auth-code-actions">
        <button className="uon-auth-link" type="button" data-auth-resend disabled={busy || wait > 0} onClick={() => void sendEmailCode()}>
          {wait > 0 ? `Reenviar código en ${formatCountdown(wait)}` : 'Reenviar código'}
        </button>
        <button className="uon-auth-link" type="button" onClick={changeEmail}>
          Cambiar correo
        </button>
      </div>
    </>
  );
}
