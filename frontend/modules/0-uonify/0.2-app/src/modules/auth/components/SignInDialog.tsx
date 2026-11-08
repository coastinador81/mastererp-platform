import { closeSignIn } from '../flows/access';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { useAuthUi, type SignInView } from '../state/authUi';
import { BRAND } from './brand';
import { SignInCode, SignInEmail } from './SignInEmail';
import { SignInProviders } from './SignInProviders';

const HEADINGS: Record<SignInView, { overline: string; title: string }> = {
  providers: { overline: 'TU ESPACIO UONIFY', title: 'Entra en Uonify' },
  email: { overline: 'ACCESO CON TU CORREO', title: 'Entra con tu correo' },
  code: { overline: 'ACCESO CON TU CORREO', title: 'Revisa tu correo' },
};

function introFor(view: SignInView, email: string): string {
  if (view === 'email') return 'Te enviaremos un código de 6 dígitos para confirmar que el correo es tuyo. Sin contraseñas.';
  if (view === 'code') return `Hemos enviado un código de 6 dígitos a ${email}. Caduca en 10 minutos.`;
  return 'Elige cómo quieres entrar. No necesitas contraseña.';
}

/**
 * «Entra en Uonify» (prototipo: #uon-auth-dialog) con tres formas de entrar:
 * ChatGPT (piloto de OpenAI), Google y el correo con un código de 6 dígitos.
 */
export function SignInDialog() {
  const open = useAuthUi(state => state.dialog === 'signin');
  const view = useAuthUi(state => state.signIn.view);
  const email = useAuthUi(state => state.signIn.email.trim());
  const { ref, onKeyDown } = useNativeDialog(open, closeSignIn);
  const heading = HEADINGS[view];

  return (
    <dialog
      ref={ref}
      id="uon-auth-dialog"
      className="uon-auth-dialog"
      aria-labelledby="uon-auth-title"
      aria-describedby="uon-auth-intro"
      data-view={view}
      onKeyDown={onKeyDown}
    >
      <div className="uon-auth-shell">
        <div className="uon-auth-brand" aria-hidden="true">
          <img data-uonify-logo="relief" src={BRAND.wordmark} alt="" width={230} height={49} />
          <div className="uon-auth-brand-copy">
            <span>Un espacio para hacerlo posible.</span>
            <p>Tus ideas, tus productos y todo lo que necesitas para avanzar.</p>
          </div>
          <img className="uon-auth-character" src={BRAND.character} alt="" width={220} height={220} />
        </div>
        <div className="uon-auth-content">
          <button className="uon-auth-close" type="button" data-auth-close aria-label="Cerrar acceso" onClick={closeSignIn}>
            ×
          </button>
          <p className="uon-auth-overline">{heading.overline}</p>
          <h2 id="uon-auth-title">{heading.title}</h2>
          <p id="uon-auth-intro">{introFor(view, email)}</p>
          {open && view === 'providers' ? <SignInProviders /> : null}
          {open && view === 'email' ? <SignInEmail /> : null}
          {open && view === 'code' ? <SignInCode /> : null}
          <LegalLinks />
        </div>
      </div>
    </dialog>
  );
}

function LegalLinks() {
  return (
    <div className="uon-auth-legal">
      <a href="/privacidad" target="_blank" rel="noopener">
        Privacidad
      </a>
      <span aria-hidden="true">·</span>
      <a href="/terminos" target="_blank" rel="noopener">
        Condiciones
      </a>
      <span aria-hidden="true">·</span>
      <a href="mailto:hola@uonify.com">hola@uonify.com</a>
    </div>
  );
}
