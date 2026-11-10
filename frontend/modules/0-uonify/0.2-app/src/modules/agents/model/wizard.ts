import { PREDEFINED_AGENTS, type AgentMode } from './catalog';
import type { NewDraft } from './store';

/** Pasos del asistente «Crear agente» (agent-builder.mjs del equipo). */
export const WIZARD_STEPS = [
  'Tipo de agente',
  'Identidad y objetivo',
  'Conocimiento',
  'Herramientas y conexiones',
  'Límites y aprobaciones',
  'Prueba y resumen',
] as const;

export interface Template {
  id: string;
  label: string;
  text: string;
  mode: AgentMode;
  name: string;
  goal: string;
}

/** Plantillas de partida (agent-builder-demo.mjs). */
export const TEMPLATES: readonly Template[] = [
  { id: 'cero', label: 'Empezar desde cero', text: 'Define tú el objetivo, el conocimiento y los límites.', mode: 'simple', name: '', goal: '' },
  { id: 'cobro', label: 'Recordatorios de cobro', text: 'Sigue las partidas vencidas y prepara recordatorios amables.', mode: 'simple', name: 'Recordatorios de cobro', goal: 'Preparar recordatorios de cobro según la política de la empresa.' },
  { id: 'atencion', label: 'Coordinador de atención', text: 'Clasifica solicitudes y reparte cada una al agente adecuado.', mode: 'orchestrator', name: 'Coordinador de atención', goal: 'Clasificar las solicitudes de clientes y preparar la respuesta adecuada.' },
];

/** Documentos de conocimiento que se pueden vincular. */
export const KNOWLEDGE_OPTIONS: readonly string[] = ['Política de cobro', 'Guía de tono de marca', 'Catálogo resumido', 'Condiciones de pago'];

export const TONE_OPTIONS: readonly string[] = ['Cercano y profesional', 'Formal', 'Directo y breve'];

export interface ApprovalOption { id: string; label: string }

export const APPROVAL_OPTIONS: readonly ApprovalOption[] = [
  { id: 'enviar', label: 'Enviar mensajes a clientes' },
  { id: 'importes', label: 'Operaciones con importes' },
  { id: 'datos', label: 'Cambiar datos maestros' },
  { id: 'publicar', label: 'Publicar contenido' },
];

export const MODULE_OPTIONS: readonly string[] = PREDEFINED_AGENTS.map(agent => agent.module);

export const emptyDraft = (): NewDraft => ({
  name: '',
  mode: 'simple',
  module: MODULE_OPTIONS[0] ?? 'Finanzas',
  goal: '',
  tone: TONE_OPTIONS[0] ?? '',
  knowledge: [],
  integrations: [],
  approvals: ['enviar', 'importes'],
});

/** Lo que falta en un paso para poder continuar (null si está completo). */
export function stepProblem(step: number, draft: NewDraft): string | null {
  if (step === 1 && !draft.name.trim()) return 'Escribe un nombre para el agente.';
  if (step === 1 && !draft.goal.trim()) return 'Describe el objetivo del agente.';
  return null;
}
