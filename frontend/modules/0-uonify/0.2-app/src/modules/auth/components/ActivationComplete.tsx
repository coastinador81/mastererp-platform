import { useEffect, useRef } from 'react';
import { Icon } from '@/shared/ui';
import type { ActivationState } from '../model/activation';
import { useCompactActivation } from '../hooks/useCompactActivation';

interface Props { state: ActivationState; intent: string; busy: boolean; onContinue: () => void }

/** El pago confirmado permanece visible hasta que el cliente decide entrar. */
export function ActivationComplete({ state, intent, busy, onContinue }: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  const compact = useCompactActivation();
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  return <section className="activation-complete" aria-labelledby="activation-complete-title">
    <h2 id="activation-complete-title" ref={title} tabIndex={-1}>{state.activation?.basis === 'trial' ? 'Tu prueba está activa' : state.activation?.basis === 'paid' ? 'Tu suscripción está activa' : 'Tu acceso está confirmado'}</h2>
    <p>{compact ? 'Tu cuenta está preparada. Empecemos con Uony.' : 'Bienvenido a Uonify. Tu cuenta está preparada para empezar con Uony.'}</p>
    <dl className="activation-complete-summary">
      {!compact && <div><dt>Tu cuenta</dt><dd>Ya puedes utilizar las herramientas de Uonify con tu acceso activo.</dd></div>}
      <div><dt>{state.drive.connected ? 'Google Drive conectado' : 'Google Drive para más adelante'}</dt><dd>{compact ? state.drive.connected ? 'Elige tus archivos cuando los necesites.' : 'Conéctalo cuando necesites tus archivos.' : state.drive.connected ? 'Uony podrá trabajar con los documentos e imágenes que elijas para tus productos.' : 'Podrás conectarlo cuando quieras aportar tus documentos e imágenes.'}</dd></div>
      <div><dt>IA de Google preparada</dt><dd>{compact ? `Proyecto ${state.cloud.projectName || state.cloud.projectId || 'de tu cuenta'} comprobado para trabajar con Uony.` : `El proyecto ${state.cloud.projectName || state.cloud.projectId || 'de tu cuenta'} está comprobado para que Uony pueda utilizar la IA de Google.`}</dd></div>
    </dl>
    <div className="activation-complete-next">
      <h3>{intent.trim() ? 'Continuamos con tu petición' : 'Tu siguiente paso'}</h3>
      {intent.trim() ? <><p className="activation-complete-intent">{intent}</p>{!compact && <p>La retomaremos en tu primera conversación con Uony.</p>}</> : <p>{compact ? 'Elige con Uony tu primera tarea: preparar un producto o conectar un canal de venta.' : 'Uony te ayudará a elegir tu primera tarea. Puedes empezar por preparar un producto o conectar un canal de venta.'}</p>}
    </div>
    <div className="activation-actions"><button className="uon-profile-submit" type="button" disabled={busy} aria-busy={busy || undefined} onClick={onContinue}>{busy ? 'Abriendo tu espacio…' : 'Continuar con Uony'}<Icon name="uony" /></button></div>
  </section>;
}
