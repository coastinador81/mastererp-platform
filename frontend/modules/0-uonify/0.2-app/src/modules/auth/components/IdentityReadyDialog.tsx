import { useState } from 'react';
import { signOut } from '../flows/account';
import { dismissProfile } from '../flows/profile';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { useAuthSession } from '../hooks/useSession';
import { useAuthUi } from '../state/authUi';
import { BRAND, GoogleMark } from './brand';
import '../styles/identity-ready.css';

/** Primera entrega integrada: cuenta confirmada, sin activar módulos ni cobros. */
export function IdentityReadyDialog() {
  const open = useAuthUi(state => state.dialog === 'profile');
  const session = useAuthSession();
  const [busy, setBusy] = useState(false);
  const { ref, onKeyDown } = useNativeDialog(open, dismissProfile);
  const logout = async () => {
    setBusy(true);
    try { await signOut(); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} className="uon-identity-ready" aria-labelledby="uon-identity-title" onKeyDown={onKeyDown}>
      <button className="uon-auth-close" type="button" aria-label="Cerrar cuenta" onClick={dismissProfile}>×</button>
      <img className="uon-identity-brand" src={BRAND.wordmark} width={146} height={31} alt="Uonify" />
      <p className="uon-auth-overline">TU CUENTA UONIFY</p>
      <h2 id="uon-identity-title">Ya estás en Uonify.</h2>
      <p className="uon-onboard-intro">Tu acceso está confirmado. Puedes volver con esta misma cuenta y continuar desde aquí.</p>
      <div className="uon-identity-account"><GoogleMark /><div><strong>{session.identityName || 'Tu cuenta de Google'}</strong><span>{session.email}</span></div></div>
      <p className="uon-identity-note">Acceso confirmado · Alta por completar</p>
      <div className="uon-identity-actions">
        <button className="uon-onboard-back" type="button" onClick={() => void logout()} disabled={busy}>{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
        <button className="uon-profile-submit" type="button" onClick={dismissProfile}>Volver al inicio</button>
      </div>
    </dialog>
  );
}
