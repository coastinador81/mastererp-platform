import { useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import type { NexusRequestDetails } from '../../model/nexusCatalog';
import '../../styles/nexus-request.css';

interface Props {
  name: string;
  details: NexusRequestDetails;
  requested: boolean;
  onRequest: () => void;
}

/** Ficha de una conexión que se activa por solicitud. Nunca la presenta como conectada. */
export function NexusRequestPanel({ name, details, requested, onRequest }: Props) {
  const [justSent, setJustSent] = useState(false);
  const send = () => { onRequest(); setJustSent(true); };
  return <div className="nxr-panel">
    <p className="nxr-lead">{details.does}</p>
    <section aria-labelledby="nxr-uony">
      <h3 id="nxr-uony"><Sparkles size={15} aria-hidden="true" /> Qué podrá hacer Uony</h3>
      <ul>{details.uony.map(item => <li key={item}>{item}</li>)}</ul>
    </section>
    <section aria-labelledby="nxr-permissions">
      <h3 id="nxr-permissions"><ShieldCheck size={15} aria-hidden="true" /> Permisos que se solicitarán</h3>
      <ul>{details.permissions.map(item => <li key={item}>{item}</li>)}</ul>
    </section>
    {requested
      ? <p className="nxr-done" role="status"><Check size={15} aria-hidden="true" />{justSent ? 'Solicitud registrada. Activaremos esta conexión en tu espacio y te avisaremos.' : 'Activación solicitada. Te avisaremos cuando esté lista en tu espacio.'}</p>
      : <div className="nxr-actions"><button className="nxs-primary" onClick={send} aria-label={`Solicitar activación de ${name}`}>Solicitar activación</button><span>Tú decides qué permisos concedes al activarla.</span></div>}
  </div>;
}
