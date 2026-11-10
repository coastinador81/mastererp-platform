import { PREDEFINED_AGENTS, MODE_LABEL, INTEGRATIONS, type Section as SectionModel, type SectionAction } from '../model/catalog';
import { useAgentsStore } from '../model/store';
import { AgentIcon, SheetHeader, initialOf } from './Parts';

export interface SectionViewProps {
  section: SectionModel;
  onClose: (detail: number) => void;
  onAction: (action: SectionAction) => void;
  onOpenAgent: (id: string) => void;
}

/** Inicio del Centro de Agentes: indicadores, primeros pasos y agentes listos. */
function HomeBody({ onAction, onOpenAgent }: Pick<SectionViewProps, 'onAction' | 'onOpenAgent'>) {
  const drafts = useAgentsStore(state => state.drafts);
  const requested = useAgentsStore(state => state.requested);
  const metrics = [
    { label: 'Agentes activos', value: PREDEFINED_AGENTS.length, note: 'Agentes predeterminados listos' },
    { label: 'Agentes personalizados', value: drafts.length, note: drafts.length ? 'Creados por tu equipo' : 'Crea el primero cuando quieras' },
    { label: 'Aprobaciones por revisar', value: 0, note: 'Nada requiere tu revisión' },
    { label: 'Integraciones solicitadas', value: requested.length, note: requested.length ? 'Activación en curso' : 'Conecta tus sistemas cuando estés listo' },
  ];
  return (
    <>
      <div className="agents-metrics" role="list">
        {metrics.map(metric => (
          <div key={metric.label} className="pim-card agents-metric" role="listitem">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </div>
        ))}
      </div>
      <div className="agents-grid">
        <section className="pim-card agents-panel">
          <span className="agents-kicker">Primeros pasos</span>
          <h2>Prepara tu centro</h2>
          <p>Empieza por definir el conocimiento y las reglas que los agentes deben respetar.</p>
          <div className="agents-links">
            <button type="button" className="pim-btn pim-btn-outline" onClick={() => onAction('crear-agente')}>Crear un agente personalizado</button>
            <button type="button" className="pim-btn pim-btn-outline" onClick={() => onAction('abrir-predeterminados')}>Revisar los agentes predeterminados</button>
          </div>
        </section>
        <section className="pim-card agents-panel">
          <span className="agents-kicker">Agentes listos</span>
          <h2>Tu equipo de agentes, bajo control</h2>
          <ul className="agents-ready">
            {PREDEFINED_AGENTS.slice(0, 4).map(agent => (
              <li key={agent.id}>
                <button type="button" className="agents-ready-item" onClick={() => onOpenAgent(agent.id)}>
                  <span className="agents-mark" aria-hidden="true">{initialOf(agent.name)}</span>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{MODE_LABEL[agent.mode]} · {agent.summary}</small>
                  </span>
                  <span className="pim-badge pim-badge-green">Listo</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

/** Integraciones y canales: servicios disponibles y su solicitud de activación. */
function IntegrationsBody() {
  const requested = useAgentsStore(state => state.requested);
  const requestActivation = useAgentsStore(state => state.requestActivation);
  return (
    <ul className="agents-integrations">
      {INTEGRATIONS.map(item => {
        const done = requested.includes(item.id);
        return (
          <li key={item.id} className="pim-card agents-integration">
            <span className="agents-mark" aria-hidden="true">{initialOf(item.name)}</span>
            <div>
              <strong>{item.name}</strong>
              <small>{item.platform} · {item.summary}</small>
              {done ? <p className="agents-request-note" role="status">Solicitud registrada: activaremos esta conexión en tu espacio.</p> : null}
            </div>
            {done ? (
              <span className="pim-badge pim-badge-blue">Solicitada</span>
            ) : (
              <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={() => requestActivation(item.id)}>Solicitar activación</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Un apartado del menú abierto en el centro (Inicio, Conocimiento, Flujos, etc.). */
export function SectionView({ section, onClose, onAction, onOpenAgent }: SectionViewProps) {
  return (
    <div className="product-editor-layout agents-sheet">
      <SheetHeader
        mark={<AgentIcon name={section.icon} />}
        title={section.id === 'inicio' ? 'Centro de agentes' : section.label}
        subtitle={section.lead}
        closeLabel="Cerrar y volver a la conversación"
        onClose={onClose}
        actions={section.id === 'inicio' ? <button type="button" className="pim-btn pim-btn-primary" onClick={() => onAction('crear-agente')}>Crear agente</button> : undefined}
      />
      <div className="agents-body">
        {section.id === 'inicio' ? <HomeBody onAction={onAction} onOpenAgent={onOpenAgent} /> : null}
        {section.id === 'integraciones' ? <IntegrationsBody /> : null}
        {section.empty ? (
          <div className="pim-card pim-card-dashed agents-empty">
            <span className="agents-mark agents-mark-lg" aria-hidden="true"><AgentIcon name={section.icon} /></span>
            <h2>{section.empty.title}</h2>
            <p>{section.empty.text}</p>
            <button type="button" className="pim-btn pim-btn-primary" onClick={() => onAction(section.empty!.does)}>{section.empty.action}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
