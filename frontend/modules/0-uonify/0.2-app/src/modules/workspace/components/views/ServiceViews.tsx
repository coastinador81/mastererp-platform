import { useState } from 'react';
import { returnToChat, selectService } from '../../hooks/actions';
import { SERVICES, serviceIcon, type NexusChannel, type ServiceId } from '../../model/services';

/**
 * Vistas de los servicios que no son Producto (app-shell.js, `renderNexus` y
 * `renderOtherService`): cabecera del servicio y su punto de partida. Comparten
 * con la conversación una columna centrada de 1040 px.
 */
function ModuleHeader({ service }: { service: ServiceId }) {
  const data = SERVICES[service];
  return (
    <header className="module-header">
      <div>
        <p className="module-eyebrow">{data.name}</p>
        <h1>{service === 'producto' ? 'Catálogo' : data.name}</h1>
        <p>{data.description}</p>
      </div>
    </header>
  );
}

/**
 * Página de un servicio sin vista propia: icono oficial, descripción, capacidades
 * y la entrada natural del servicio, que es pedírselo a Uony en la conversación.
 */
export function ServicePage({ service, onAsk }: { service: ServiceId; onAsk: () => void }) {
  const data = SERVICES[service];
  return (
    <>
      <ModuleHeader service={service} />
      <div className="service-surface">
        <div className="module-empty">
          <img src={serviceIcon(service)} alt="" />
          <h2>{data.title ?? data.name}</h2>
          <p>{data.detail ?? data.description}</p>
          {data.capabilities?.length ? (
            <div className="channel-grid" style={{ width: '100%', marginBottom: 24 }}>
              {data.capabilities.map(capability => (
                <div key={capability} className="channel-card" style={{ minHeight: 0 }}>
                  <span><strong>{capability}</strong></span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="module-actions">
            <button type="button" className="primary-action" onClick={onAsk}>Pedírselo a Uony</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** ERP, Analítica, Captura y auditoría, Agentes, Academy, Logística y Fábrica. */
export function ServiceView({ service }: { service: ServiceId }) {
  return <ServicePage service={service} onAsk={returnToChat} />;
}

const CHANNEL_NAMES: Record<NexusChannel, string> = { amazon: 'Amazon', shopify: 'Shopify' };

/** Nexus: canales que se pueden conectar con el espacio. */
export function NexusView() {
  return (
    <>
      <ModuleHeader service="nexus" />
      <div className="channel-grid">
        <button type="button" className="channel-card" data-work-action="channel" data-channel="amazon" onClick={() => selectService('nexus', 'amazon')}>
          <span>
            <strong>Amazon</strong>
            <small>Importa y consulta tus productos desde una cuenta autorizada.</small>
          </span>
          <span>Conectar cuenta →</span>
        </button>
        <button type="button" className="channel-card" data-work-action="channel" data-channel="shopify" onClick={() => selectService('nexus', 'shopify')}>
          <span>
            <strong>Shopify</strong>
            <small>Trae los productos de tu tienda a Uonify.</small>
          </span>
          <span>Conectar cuenta →</span>
        </button>
      </div>
    </>
  );
}

/**
 * Nexus › canal: autorizar el acceso a la cuenta. La autorización real la hará el
 * backend con el canal (OAuth); aquí se indica cómo se completará, como el PROTO.
 */
export function NexusChannelView({ channel }: { channel: NexusChannel }) {
  const name = CHANNEL_NAMES[channel];
  const [requested, setRequested] = useState(false);
  return (
    <>
      <button type="button" className="module-back" data-work-action="connections" onClick={() => selectService('nexus')}>
        ← Volver a conexiones
      </button>
      <ModuleHeader service="nexus" />
      <div className="service-surface">
        <div className="module-empty">
          <img src={serviceIcon('nexus')} alt="" />
          <h2>Conectar {name}</h2>
          <p>Autoriza el acceso a tu cuenta para importar productos y mantenerlos sincronizados.</p>
          <div className="module-actions">
            <button type="button" className="primary-action" data-work-action="authorize-channel" data-channel={name} disabled={requested} onClick={() => setRequested(true)}>
              Continuar con {name}
            </button>
            {requested ? (
              <p className="module-back" role="status">
                La autorización de {name} se completará al vincular una cuenta de Uonify.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
