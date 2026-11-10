import { returnToChat } from '../hooks/actions';
import { type ServiceId } from '../model/services';
import { LiveNexus } from './LiveNexus';
import { ServicePage } from './views/ServiceViews';

/** Servicios en la app real: Nexus tiene su vista; el resto, su página de servicio con Uony como entrada. */
export function LiveServiceView({ service }: { service: ServiceId }) {
  if (service === 'nexus') return <LiveNexus />;
  return <section className="live-service-view"><ServicePage service={service} onAsk={returnToChat} /></section>;
}
