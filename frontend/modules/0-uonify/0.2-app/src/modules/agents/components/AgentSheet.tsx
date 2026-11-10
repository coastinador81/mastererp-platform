import { useState } from 'react';
import { MODE_LABEL, findIntegration, type AgentMode } from '../model/catalog';
import { APPROVAL_OPTIONS } from '../model/wizard';
import { Section, SheetHeader, initialOf } from './Parts';

export interface AgentSheetData {
  name: string;
  module: string;
  mode: AgentMode;
  summary: string;
  origin: 'predeterminado' | 'personalizado';
  knowledge: string[];
  integrations: string[];
  approvals: string[];
  tone?: string;
}

export interface AgentSheetProps {
  agent: AgentSheetData;
  onClose: (detail: number) => void;
  onTalk: () => void;
}

/**
 * Ficha «Configuración del agente» (configuracion.html del equipo): modo de operación,
 * entrenamiento y conocimiento, chat del módulo y permisos y aprobaciones.
 */
export function AgentSheet({ agent, onClose, onTalk }: AgentSheetProps) {
  const [mode, setMode] = useState<AgentMode>(agent.mode);
  const [approvals, setApprovals] = useState<string[]>(agent.approvals);
  const predefined = agent.origin === 'predeterminado';
  const toggleApproval = (id: string, on: boolean) => setApprovals(list => (on ? [...list, id] : list.filter(item => item !== id)));

  return (
    <div className="product-editor-layout agents-sheet">
      <SheetHeader
        mark={<span className="agents-heading-initial">{initialOf(agent.name)}</span>}
        title={agent.name}
        subtitle={predefined ? `Agente predeterminado del módulo ${agent.module}, listo para operar.` : `Agente personalizado · ${agent.module}`}
        status={predefined ? 'Listo' : 'Borrador'}
        closeLabel="Cerrar la ficha del agente"
        onClose={onClose}
      />
      <div className="agents-body">
        <Section title="Modo de operación" sub="Un agente simple resuelve tareas de su módulo; un coordinador reparte el trabajo entre varios agentes.">
          <div className="agents-choice" role="radiogroup" aria-label="Tipo de agente">
            {(['simple', 'orchestrator'] as const).map(option => (
              <label key={option} className={mode === option ? 'agents-option is-selected' : 'agents-option'}>
                <input type="radio" name="agent-mode" className="pim-check" checked={mode === option} onChange={() => setMode(option)} />
                <span>{MODE_LABEL[option]}</span>
              </label>
            ))}
          </div>
        </Section>
        <Section title="Entrenamiento y conocimiento" sub="Las reglas, documentos, tono y prioridades de la empresa que el agente respeta.">
          {agent.knowledge.length ? (
            <ul className="agents-tags">
              {agent.knowledge.map(item => <li key={item} className="pim-badge">{item}</li>)}
            </ul>
          ) : (
            <p className="pim-hint">{predefined ? `Base de conocimiento del módulo ${agent.module} vinculada.` : 'Sin documentos añadidos.'}</p>
          )}
          {agent.tone ? <p className="pim-hint">Tono: {agent.tone}</p> : null}
        </Section>
        <Section title="Chat del módulo" sub="Canal de chat del módulo para consultas y seguimiento.">
          <div>
            <button type="button" className="pim-btn pim-btn-outline" onClick={onTalk}>Hablar con Uony sobre este agente</button>
          </div>
        </Section>
        <Section title="Permisos y aprobaciones" sub="Decisiones que requieren tu revisión antes de que el agente las ejecute.">
          <div className="agents-checks">
            {APPROVAL_OPTIONS.map(option => (
              <label key={option.id} className="agents-check">
                <input type="checkbox" className="pim-check" checked={approvals.includes(option.id)} onChange={event => toggleApproval(option.id, event.target.checked)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {agent.integrations.length ? (
            <p className="pim-hint">Conexiones pedidas: {agent.integrations.map(id => findIntegration(id)?.name ?? id).join(', ')}.</p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
