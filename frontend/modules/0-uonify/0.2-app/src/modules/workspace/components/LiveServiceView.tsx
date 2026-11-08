import { Icon } from '@/shared/ui';
import { returnToChat } from '../hooks/actions';
import { SERVICES, serviceIcon, type ServiceId } from '../model/services';
import { LiveNexus } from './LiveNexus';

/** Mantiene los servicios visibles sin ejecutar los flujos simulados del prototipo. */
export function LiveServiceView({ service }: { service: ServiceId }) {
  const data = SERVICES[service];
  if (service === 'nexus') return <LiveNexus />;
  return <section className="live-service-view">
    <header className="module-header"><div><p className="module-eyebrow">Servicios de Uonify</p><h1>{data.name}</h1><p>{data.description}</p></div></header>
    <div className="service-surface"><div className="module-empty">
      <img src={serviceIcon(service)} alt="" />
      {service === 'agentes' ? <><h2>Habla con Uony</h2><p>Uony ya responde con Gemini. Las herramientas para ejecutar tareas se irán incorporando a tu cuenta.</p><button type="button" className="primary-action" onClick={returnToChat}><Icon name="uony" /> Hablar con Uony</button></> : <><h2>Estamos preparando este servicio</h2><p>{service === 'producto' ? 'La creación, edición y publicación de fichas se está conectando a tu cuenta. Tus conversaciones con Uony siguen disponibles.' : 'Este módulo todavía no está habilitado para operar con los datos de tu cuenta.'}</p><button type="button" className="module-back" onClick={returnToChat}>Volver a la conversación</button></>}
    </div></div>
  </section>;
}
