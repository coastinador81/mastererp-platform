import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { useInterval } from '@/shared/hooks';
import { Alert, Button, Field, Input, LinkButton } from '@/shared/ui';
import { adminAuthApi } from '../../api/adminApi';
import { cleanCode, companyEmailError, COMPANY_DOMAIN, isRecoveryCode, isSixDigitCode, normalizeEmail } from '../../model/email';
import type { AdminSession, EmailChallenge, MfaChallenge, MfaMethod, PreviewHint } from '../../model/types';

/** Pasos del acceso del equipo. Cada paso enfoca su campo al aparecer. */

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

/** Texto de la simulación con el código (el backend real nunca lo envía). */
function Preview({ hint }: { hint?: PreviewHint }) {
  if (!hint) return null;
  return (
    <Alert tone="info" role="note" className="adm-auth-preview">
      {hint.message}
    </Alert>
  );
}

export function EmailStep({ initialEmail, onSent }: { initialEmail: string; onSent: (email: string, challenge: EmailChallenge) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useFocusOnMount<HTMLInputElement>();
  const start = useMutation({ mutationFn: adminAuthApi.startEmail, onSuccess: (challenge, sent) => onSent(sent, challenge) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = companyEmailError(email);
    setProblem(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    start.mutate(normalizeEmail(email));
  };

  const error = problem ?? (start.error ? errorMessage(start.error) : null);
  return (
    <form className="adm-auth-form" onSubmit={submit} noValidate>
      <p className="adm-auth-intro">Escribe tu correo de empresa. Te enviaremos un código para entrar.</p>
      <Field label="Correo de empresa" hint={`Solo correos @${COMPANY_DOMAIN}.`} error={error ?? undefined}>
        <Input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder={`nombre@${COMPANY_DOMAIN}`}
          value={email}
          onChange={event => {
            setEmail(event.target.value);
            setProblem(null);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" block icon="adm-mail" loading={start.isPending}>
        Enviar código
      </Button>
    </form>
  );
}

export function CodeStep({
  challenge,
  onResent,
  onVerified,
  onRestart,
}: {
  challenge: EmailChallenge;
  onResent: (challenge: EmailChallenge) => void;
  onVerified: (mfa: MfaChallenge) => void;
  onRestart: () => void;
}) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [wait, setWait] = useState(challenge.resendAfter);
  const inputRef = useFocusOnMount<HTMLInputElement>();
  useInterval(() => setWait(seconds => Math.max(0, seconds - 1)), wait > 0 ? 1000 : null);

  const verify = useMutation({
    mutationFn: (value: string) => adminAuthApi.verifyEmail(challenge.challengeId, value),
    onSuccess: onVerified,
    onError: () => inputRef.current?.select(),
  });
  const resend = useMutation({
    mutationFn: () => adminAuthApi.resendEmail(challenge.challengeId),
    onSuccess: next => {
      setWait(next.resendAfter);
      setCode('');
      verify.reset();
      onResent(next);
      inputRef.current?.focus();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isSixDigitCode(code)) {
      setProblem('Escribe el código de 6 cifras que te hemos enviado.');
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    verify.mutate(cleanCode(code));
  };

  const error = problem ?? (verify.error ? errorMessage(verify.error) : null) ?? (resend.error ? errorMessage(resend.error) : null);
  return (
    <form className="adm-auth-form" onSubmit={submit} noValidate>
      <p className="adm-auth-intro" role="status">
        Si <strong>{challenge.maskedEmail}</strong> es del equipo, te hemos enviado un código. Caduca en 10 minutos.
      </p>
      <Preview hint={challenge.preview} />
      <Field label="Código de 6 cifras" error={error ?? undefined}>
        <Input
          ref={inputRef}
          mono
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          className="adm-code-input"
          value={code}
          onChange={event => {
            setCode(event.target.value.replace(/[^\d\s]/g, ''));
            setProblem(null);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={verify.isPending}>
        Verificar código
      </Button>
      <div className="adm-auth-links">
        <LinkButton onClick={() => resend.mutate()} disabled={wait > 0 || resend.isPending}>
          {wait > 0 ? `Reenviar código en ${wait} s` : 'Reenviar código'}
        </LinkButton>
        <LinkButton onClick={onRestart}>Usar otro correo</LinkButton>
      </div>
    </form>
  );
}

export function MfaStep({ mfa, onSignedIn, onRestart }: { mfa: MfaChallenge; onSignedIn: (session: AdminSession) => void; onRestart: () => void }) {
  const [method, setMethod] = useState<MfaMethod>('totp');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useFocusOnMount<HTMLInputElement>();
  const verify = useMutation({
    mutationFn: (value: string) => adminAuthApi.verifyMfa(mfa.mfaChallengeId, method, value),
    onSuccess: onSignedIn,
    onError: () => inputRef.current?.select(),
  });

  const switchMethod = () => {
    setMethod(current => (current === 'totp' ? 'recovery' : 'totp'));
    setCode('');
    setProblem(null);
    verify.reset();
    inputRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const valid = method === 'totp' ? isSixDigitCode(code) : isRecoveryCode(code);
    if (!valid) {
      setProblem(method === 'totp' ? 'Escribe el código de 6 cifras de tu aplicación.' : 'Escribe un código de recuperación como K7QD-M2XP.');
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    verify.mutate(method === 'totp' ? cleanCode(code) : code.trim());
  };

  const error = problem ?? (verify.error ? errorMessage(verify.error) : null);
  const totp = method === 'totp';
  return (
    <form className="adm-auth-form" onSubmit={submit} noValidate>
      <p className="adm-auth-intro">
        {totp
          ? 'Verificación en dos pasos: abre tu aplicación de autenticación y escribe el código que muestra para Uonify.'
          : 'Escribe uno de tus 10 códigos de recuperación. Cada código sirve una sola vez.'}
      </p>
      <Preview hint={mfa.preview} />
      <Field label={totp ? 'Código de la aplicación' : 'Código de recuperación'} error={error ?? undefined}>
        <Input
          ref={inputRef}
          mono
          inputMode={totp ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          maxLength={totp ? 7 : 9}
          className="adm-code-input"
          value={code}
          onChange={event => {
            setCode(event.target.value);
            setProblem(null);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" block icon="shield" loading={verify.isPending}>
        Entrar en el panel
      </Button>
      <div className="adm-auth-links">
        {mfa.methods.includes('recovery') ? (
          <LinkButton onClick={switchMethod}>{totp ? 'Usar un código de recuperación' : 'Usar la aplicación de autenticación'}</LinkButton>
        ) : null}
        <LinkButton onClick={onRestart}>Volver a empezar</LinkButton>
      </div>
    </form>
  );
}
