import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { INTEGRATIONS, MODE_LABEL, findIntegration } from '../model/catalog';
import { useAgentsStore, type AgentDraft, type NewDraft } from '../model/store';
import { APPROVAL_OPTIONS, KNOWLEDGE_OPTIONS, MODULE_OPTIONS, TEMPLATES, TONE_OPTIONS, WIZARD_STEPS, emptyDraft, stepProblem } from '../model/wizard';
import { AgentIcon, Section, SheetHeader } from './Parts';

export interface AgentWizardProps {
  onClose: (detail: number) => void;
  onCreated: (draft: AgentDraft) => void;
}

const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter(item => item !== id));

function Checks({ options, value, onChange }: { options: readonly { id: string; label: ReactNode }[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="agents-checks">
      {options.map(option => (
        <label key={option.id} className="agents-check">
          <input type="checkbox" className="pim-check" checked={value.includes(option.id)} onChange={event => onChange(toggle(value, option.id, event.target.checked))} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Asistente «Crear agente» en 6 pasos (crear-agente.html y agent-builder.mjs del equipo).
 * Al terminar, el agente queda como borrador en «Agentes personalizados» (en memoria).
 */
export function AgentWizard({ onClose, onCreated }: AgentWizardProps) {
  const addDraft = useAgentsStore(state => state.addDraft);
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState(TEMPLATES[0]?.id ?? 'cero');
  const [draft, setDraft] = useState<NewDraft>(emptyDraft);
  const [problem, setProblem] = useState<string | null>(null);
  const [testQuestion, setTestQuestion] = useState('');
  const [tested, setTested] = useState(false);
  const patch = (next: Partial<NewDraft>) => setDraft(current => ({ ...current, ...next }));
  const last = step === WIZARD_STEPS.length - 1;

  const pickTemplate = (id: string) => {
    const chosen = TEMPLATES.find(item => item.id === id);
    setTemplate(id);
    if (chosen) patch({ mode: chosen.mode, name: chosen.name, goal: chosen.goal });
  };

  const next = () => {
    const issue = stepProblem(step, draft);
    setProblem(issue);
    if (issue) return;
    if (last) {
      onCreated(addDraft({ ...draft, name: draft.name.trim(), goal: draft.goal.trim() }));
      return;
    }
    setStep(step + 1);
  };

  const body = () => {
    switch (step) {
      case 0:
        return (
          <>
            <Section title="Punto de partida" sub="Elige una plantilla o empieza desde cero.">
              <div className="agents-choice">
                {TEMPLATES.map(item => (
                  <label key={item.id} className={clsx('agents-option agents-option-card', template === item.id && 'is-selected')}>
                    <input type="radio" name="agent-template" className="pim-check" checked={template === item.id} onChange={() => pickTemplate(item.id)} />
                    <span><strong>{item.label}</strong><small>{item.text}</small></span>
                  </label>
                ))}
              </div>
            </Section>
            <Section title="Tipo de agente">
              <div className="agents-choice" role="radiogroup" aria-label="Tipo de agente">
                {(['simple', 'orchestrator'] as const).map(mode => (
                  <label key={mode} className={clsx('agents-option', draft.mode === mode && 'is-selected')}>
                    <input type="radio" name="agent-kind" className="pim-check" checked={draft.mode === mode} onChange={() => patch({ mode })} />
                    <span>{MODE_LABEL[mode]}</span>
                  </label>
                ))}
              </div>
            </Section>
          </>
        );
      case 1:
        return (
          <Section title="Identidad y objetivo" sub="Cómo se llama el agente, en qué módulo trabaja y qué debe conseguir.">
            <div className="agents-fields">
              <label className="pim-field">
                <span className="pim-label">Nombre</span>
                <input className="pim-input" value={draft.name} maxLength={80} onChange={event => patch({ name: event.target.value })} />
              </label>
              <label className="pim-field">
                <span className="pim-label">Módulo</span>
                <select className="pim-select" value={draft.module} onChange={event => patch({ module: event.target.value })}>
                  {MODULE_OPTIONS.map(module => <option key={module} value={module}>{module}</option>)}
                </select>
              </label>
              <label className="pim-field agents-field-wide">
                <span className="pim-label">Objetivo</span>
                <textarea className="pim-textarea" rows={3} value={draft.goal} maxLength={500} onChange={event => patch({ goal: event.target.value })} />
              </label>
              <label className="pim-field">
                <span className="pim-label">Tono</span>
                <select className="pim-select" value={draft.tone} onChange={event => patch({ tone: event.target.value })}>
                  {TONE_OPTIONS.map(tone => <option key={tone} value={tone}>{tone}</option>)}
                </select>
              </label>
            </div>
          </Section>
        );
      case 2:
        return (
          <Section title="Conocimiento" sub="Documentos y reglas que el agente debe respetar.">
            <Checks options={KNOWLEDGE_OPTIONS.map(item => ({ id: item, label: item }))} value={draft.knowledge} onChange={knowledge => patch({ knowledge })} />
          </Section>
        );
      case 3:
        return (
          <Section title="Herramientas y conexiones" sub="Las conexiones elegidas se activan en tu espacio tras registrar la solicitud.">
            <Checks options={INTEGRATIONS.map(item => ({ id: item.id, label: <>{item.name} <small className="pim-muted">· {item.platform}</small></> }))} value={draft.integrations} onChange={integrations => patch({ integrations })} />
          </Section>
        );
      case 4:
        return (
          <Section title="Límites y aprobaciones" sub="Acciones que el agente te consultará antes de ejecutarlas.">
            <Checks options={APPROVAL_OPTIONS} value={draft.approvals} onChange={approvals => patch({ approvals })} />
          </Section>
        );
      default:
        return (
          <>
            <Section title="Resumen">
              <dl className="pim-kv">
                <dt>Nombre</dt><dd>{draft.name}</dd>
                <dt>Tipo</dt><dd>{MODE_LABEL[draft.mode]}</dd>
                <dt>Módulo</dt><dd>{draft.module}</dd>
                <dt>Objetivo</dt><dd>{draft.goal}</dd>
                <dt>Conocimiento</dt><dd>{draft.knowledge.join(', ') || 'Base del módulo'}</dd>
                <dt>Conexiones</dt><dd>{draft.integrations.map(id => findIntegration(id)?.name ?? id).join(', ') || 'Ninguna'}</dd>
                <dt>Aprobaciones</dt><dd>{APPROVAL_OPTIONS.filter(option => draft.approvals.includes(option.id)).map(option => option.label).join(', ') || 'Ninguna'}</dd>
              </dl>
            </Section>
            <Section title="Prueba" sub="Escribe una pregunta para comprobar que el agente tiene el contexto adecuado.">
              <form className="agents-test" onSubmit={event => { event.preventDefault(); setTested(Boolean(testQuestion.trim())); }}>
                <input className="pim-input" value={testQuestion} placeholder="¿Cuál es el plazo de pago estándar?" onChange={event => { setTestQuestion(event.target.value); setTested(false); }} />
                <button type="submit" className="pim-btn pim-btn-outline">Comprobar</button>
              </form>
              {tested ? (
                <p className="agents-request-note" role="status">
                  El agente responderá con {draft.knowledge.length ? `${draft.knowledge.join(', ')}` : `la base del módulo ${draft.module}`} y pedirá tu aprobación para: {APPROVAL_OPTIONS.filter(option => draft.approvals.includes(option.id)).map(option => option.label.toLowerCase()).join(', ') || 'ninguna acción'}.
                </p>
              ) : null}
            </Section>
          </>
        );
    }
  };

  return (
    <div className="product-editor-layout agents-sheet">
      <SheetHeader
        mark={<AgentIcon name="spark" />}
        title="Crear agente"
        subtitle={`Paso ${step + 1} de ${WIZARD_STEPS.length} · ${WIZARD_STEPS[step]}`}
        closeLabel="Cancelar y cerrar el asistente"
        onClose={onClose}
      />
      <ol className="pim-stepper agents-stepper" aria-label="Pasos">
        {WIZARD_STEPS.map((title, index) => (
          <li key={title} className={clsx('pim-step', index === step && 'is-active', index < step && 'is-done')} aria-current={index === step ? 'step' : undefined}>
            {index === step ? <strong>{title}</strong> : title}
          </li>
        ))}
      </ol>
      <div className="agents-body">
        {body()}
        {problem ? <p className="pim-error-text" role="alert">{problem}</p> : null}
        <div className="agents-wizard-actions">
          <button type="button" className="pim-btn pim-btn-ghost" onClick={event => onClose(event.detail)}>Cancelar</button>
          <span className="agents-spacer" />
          {step > 0 ? <button type="button" className="pim-btn pim-btn-outline" onClick={() => { setProblem(null); setStep(step - 1); }}>Atrás</button> : null}
          <button type="button" className="pim-btn pim-btn-primary" onClick={next}>{last ? 'Crear agente' : 'Continuar'}</button>
        </div>
      </div>
    </div>
  );
}
