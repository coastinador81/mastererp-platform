import { useAccount } from '../../hooks/queries';
import { MfaCard } from './MfaCard';
import { SessionsCard } from './SessionsCard';
import { SignInMethodsCard } from './SignInMethodsCard';

/** Seguridad: verificación en dos pasos, sesiones abiertas y formas de entrar. */
export function SecuritySection() {
  const account = useAccount();
  return (
    <div className="uset-stack">
      <MfaCard email={account.data?.email ?? ''} />
      <SessionsCard />
      <SignInMethodsCard />
    </div>
  );
}
