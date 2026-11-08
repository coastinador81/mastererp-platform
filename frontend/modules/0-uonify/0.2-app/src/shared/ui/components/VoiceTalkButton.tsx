import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from './Button';
import { Dialog } from '../dialog/Dialog';
import './voiceWelcome.css';

const dismissedInMemory = new Set<string>();
const storageKey = (account: string) => `uonify-voice-intro-dismissed:${account}`;
function isDismissed(account: string): boolean {
  if (dismissedInMemory.has(account) || dismissedInMemory.has('visitor')) return true;
  try { return localStorage.getItem(storageKey(account)) === '1' || localStorage.getItem(storageKey('visitor')) === '1'; } catch { return false; }
}
function dismiss(account: string): void {
  dismissedInMemory.add(account);
  try { localStorage.setItem(storageKey(account), '1'); } catch { /* Conservar durante esta visita si el almacenamiento está bloqueado. */ }
}

interface Props { account: string; active: boolean; listen(): void }
/** Misma invitación; solo se oculta si el cliente elige «No volver a mostrar». */
export function VoiceTalkButton({ account, ...props }: Props) {
  return <AccountVoiceButton key={account} account={account} {...props} />;
}
function AccountVoiceButton({ account, active, listen }: Props) {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const close = () => {
    if (dontShowAgain) dismiss(account);
    setOpen(false);
  };
  // La animación permanece, independientemente de la preferencia de bienvenida.
  const animate = Boolean(account && !active);
  const invite = animate && !isDismissed(account);
  const click = () => {
    if (!invite) { listen(); return; }
    setDontShowAgain(false);
    setOpen(true);
  };
  return <>
    <button className={`composer-voice-button${animate ? ' is-inviting' : ''}`} type="button" data-composer-talk=""
      aria-label={active ? 'Terminar conversación de voz' : 'Hablar con Uony'} aria-pressed={active}
      aria-haspopup={invite || open ? 'dialog' : undefined} data-tooltip={active ? 'Terminar conversación de voz' : 'Hablar con Uony'} data-tooltip-align="end" onClick={click}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{['M3 10v4', 'M7 7v10', 'M11 3v18', 'M15 6v12', 'M19 10v4', 'M22 8v8'].map(d => <path key={d} d={d} />)}</svg>
    </button>
    <Dialog open={open} onClose={close} size="md" className="uony-voice-welcome-dialog"
      title={<><img className="uony-voice-wordmark" src="/assets/brands/uonify-wordmark-3d.webp" width="152" height="32" alt="" aria-hidden="true" /><span className="sr-only">Cuéntaselo a Uony</span></>} footer={<>
        <label className="uony-voice-preference"><input type="checkbox" checked={dontShowAgain} onChange={event => setDontShowAgain(event.target.checked)} />No volver a mostrar</label>
        <div className="uony-voice-footer-actions">
          <Button onClick={close}>Ahora no</Button>
          <Button variant="primary" icon="uony" onClick={() => { flushSync(close); listen(); }}>Hablar con Uony</Button>
        </div>
      </>}>
      <div className="uony-voice-welcome">
        <div className="uony-voice-art" aria-hidden="true">
          <div className="uony-voice-orbit" />
          <img src="/assets/brands/uonify-isotipo-3d.webp" width="216" height="134" alt="" />
          <div className="uony-voice-wave">{[12, 24, 38, 20, 46, 30, 54, 34, 20, 42, 26, 14].map((height, index) => <i key={index} style={{ height }} />)}</div>
        </div>
        <div className="uony-voice-copy">
          <span className="uony-voice-eyebrow">TU VOZ. TODAS LAS POSIBILIDADES.</span>
          <h3>Hazlo <em>posible.</em><br />Con tu voz.</h3>
          <p>Te recomendamos hablar con Uony para aprovechar todo lo que puede hacer por ti. Te guiará paso a paso; también puedes escribir.</p>
          <div className="uony-voice-example"><span>PRUEBA A DECIR</span><q>Quiero subir un producto a Amazon</q></div>
        </div>
      </div>
    </Dialog>
  </>;
}
