import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Stepper } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useAdminSession, useSignedIn } from '../../hooks/useAdminSession';
import { adminAuthApi } from '../../api/adminApi';
import type { EmailChallenge, MfaChallenge } from '../../model/types';
import { CodeStep, EmailStep, MfaStep } from './SignInSteps';

/**
 * Acceso del equipo. El modo lo dicta el backend en GET /admin/auth/session (`authMode`):
 * «password» = formulario simple de correo + contraseña (local/desarrollo); «mfa» =
 * correo → código → verificación en dos pasos (producción). El frontend lo lee, no lo fija.
 */
export function AdminSignIn() {
  const session = useAdminSession();
  const simple = session.data?.authMode === 'password' || session.data?.passwordLogin === true;
  const signedIn = useSignedIn();
  return (
    <div className="adm-auth">
      <div className="adm-auth-card">
        <div className="adm-auth-brand" aria-hidden="true">
          <img src="/assets/brands/uonify-wordmark-3d.webp" alt="" width={150} height={32} />
          <img className="adm-auth-mascot" src="/assets/product-icons/estudio.png" alt="" width={176} height={176} />
          <div className="adm-auth-brand-copy">
            <span>El panel del equipo.</span>
            <p>Clientes, precios, proveedores y soporte en un solo sitio. Cada acción queda registrada.</p>
          </div>
        </div>
        <main className="adm-auth-content" aria-labelledby="adm-auth-title">
          <p className="adm-auth-overline">EQUIPO UONIFY</p>
          <h1 id="adm-auth-title">Entra en el panel</h1>
          {simple ? <PasswordForm onSignedIn={signedIn} /> : <StepperFlow onSignedIn={signedIn} />}
          <p className="adm-auth-legal">
            {simple
              ? 'Acceso reservado al equipo de Uonify. Si no recuerdas tu contraseña, pide a un superadmin que la restablezca.'
              : 'Acceso reservado al equipo de Uonify. Si has perdido tu aplicación de autenticación y tus códigos de recuperación, pide a un superadmin que restablezca tu acceso.'}
          </p>
        </main>
      </div>
    </div>
  );
}

type SignedIn = ReturnType<typeof useSignedIn>;

/** Modo local/desarrollo: correo de empresa + contraseña, sin código ni 2FA. */
function PasswordForm({ onSignedIn }: { onSignedIn: SignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setProblem('Escribe tu correo de empresa y tu contraseña.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onSignedIn(await adminAuthApi.password(email.trim(), password));
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <form className="adm-auth-form" onSubmit={event => void submit(event)} noValidate>
      <Field label="Correo de empresa" hint="Solo correos @uonify.com.">
        <Input type="email" value={email} placeholder="nombre@uonify.com" autoComplete="username" onChange={event => setEmail(event.target.value)} />
      </Field>
      <Field label="Contraseña">
        <Input type="password" value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} />
      </Field>
      {problem ? (
        <Alert tone="red" role="alert">
          {problem}
        </Alert>
      ) : null}
      <Button type="submit" variant="primary" loading={busy}>
        Entrar
      </Button>
    </form>
  );
}

type Step =
  | { name: 'email'; email: string }
  | { name: 'code'; email: string; challenge: EmailChallenge }
  | { name: 'mfa'; email: string; mfa: MfaChallenge };

const STEP_INDEX: Record<Step['name'], number> = { email: 0, code: 1, mfa: 2 };

/** Modo producción: correo @uonify.com → código por correo → verificación en dos pasos. */
function StepperFlow({ onSignedIn }: { onSignedIn: SignedIn }) {
  const [step, setStep] = useState<Step>({ name: 'email', email: '' });
  const restart = (email = step.email) => setStep({ name: 'email', email });
  return (
    <>
      <Stepper
        className="adm-auth-steps"
        aria-label="Pasos para entrar"
        current={STEP_INDEX[step.name]}
        steps={[{ label: 'Correo' }, { label: 'Código' }, { label: 'Verificación' }]}
      />
      {step.name === 'email' ? (
        <EmailStep initialEmail={step.email} onSent={(email, challenge) => setStep({ name: 'code', email, challenge })} />
      ) : null}
      {step.name === 'code' ? (
        <CodeStep
          challenge={step.challenge}
          onResent={challenge => setStep({ ...step, challenge })}
          onVerified={mfa => setStep({ name: 'mfa', email: step.email, mfa })}
          onRestart={() => restart()}
        />
      ) : null}
      {step.name === 'mfa' ? <MfaStep mfa={step.mfa} onSignedIn={onSignedIn} onRestart={() => restart()} /> : null}
    </>
  );
}
