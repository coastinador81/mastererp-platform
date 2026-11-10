/** Demo catalog & in-memory drafts (session only; lost on full reload). */

import { PLATFORMS, platformById, searchServices, nexusCapabilityId, SERVICES } from './nexus-catalog.mjs';

export { PLATFORMS, searchServices, nexusCapabilityId };

const ICONS = 'ACEFGIMRSTV'.split('');

export function getDemoStore() {
  if (!globalThis.__agentsDemoStore) {
    globalThis.__agentsDemoStore = {
      drafts: [],
      seq: 0,
    };
  }
  return globalThis.__agentsDemoStore;
}

export const DEMO_MODULES = [
  { id: 'mod-finance', name: 'Finanzas', desc: 'Consultar partidas y preparar recordatorios de cobro.', status: 'demo' },
  { id: 'mod-ecommerce', name: 'Ecommerce', desc: 'Catálogo, pedidos y estado de ventas.', status: 'demo' },
  { id: 'mod-inventory', name: 'Inventario', desc: 'Existencias y movimientos de almacén.', status: 'pending' },
  { id: 'mod-crm', name: 'CRM', desc: 'Contactos y oportunidades comerciales.', status: 'pending' },
  { id: 'mod-marketing', name: 'Marketing', desc: 'Campañas y audiencias.', status: 'denied' },
];

export const NEXUS_INTEGRATIONS = SERVICES.map((s) => ({
  id: nexusCapabilityId(s.id),
  serviceId: s.id,
  name: s.name,
  desc: s.description,
  platformName: platformById(s.platformId)?.name,
  status: 'pending',
}));

export function integrationCatalogItem(id) {
  return DEMO_MODULES.find((m) => m.id === id) || NEXUS_INTEGRATIONS.find((m) => m.id === id) || null;
}

export const DEMO_PREDEFINED_AGENTS = [
  { id: 'ag-finanzas', name: 'Agente Finanzas', module: 'Finanzas' },
  { id: 'ag-ecommerce', name: 'Agente Ecommerce', module: 'Ecommerce' },
  { id: 'ag-inventario', name: 'Agente Inventario', module: 'Inventario' },
  { id: 'ag-cobrador', name: 'Agente cobrador (plantilla)', module: 'Finanzas' },
];

export const DEMO_TEMPLATES = {
  blank: {
    label: 'Empezar desde cero',
    mode: 'simple',
    name: '',
    icon: 'A',
    description: '',
    objective: '',
    instructions: '',
  },
  cobrador: {
    label: 'Recordatorios de cobro',
    mode: 'simple',
    name: 'Recordatorios de cobro',
    icon: 'C',
    description: 'Prepara mensajes amables de seguimiento según tus reglas.',
    objective: 'Reducir facturas vencidas sin perder el tono de la empresa.',
    instructions: 'Consulta saldos, propone mensajes y pide aprobación antes de enviar.',
  },
  coordinador: {
    label: 'Coordinador de atención',
    mode: 'orchestrator',
    name: 'Coordinador de atención',
    icon: 'O',
    description: 'Orquesta agentes de módulo y resume resultados.',
    objective: 'Unificar respuestas entre Finanzas y Ecommerce en un solo hilo.',
    instructions: 'Pide contexto a cada agente hijo y entrega un resumen único.',
  },
};

/** Bases existentes (Centro de Documentación · solo referencias en demo). */
export const DEMO_KNOWLEDGE_BASES = [
  {
    id: 'kb-cobros',
    name: 'Política de cobro',
    description: 'Plazos, recordatorios y tono aprobado para cuentas por cobrar.',
    docCount: 2,
    docs: ['doc-synth-plazo-pago', 'doc-synth-recordatorios'],
  },
  {
    id: 'kb-tono',
    name: 'Guía de tono de marca',
    description: 'Saludo, cierre y límites de lenguaje para clientes.',
    docCount: 1,
    docs: ['doc-synth-tono'],
  },
  {
    id: 'kb-catalogo',
    name: 'Catálogo resumido',
    description: 'Referencias de productos ficticios para respuestas de ejemplo.',
    docCount: 1,
    docs: ['doc-synth-catalogo'],
  },
];

/** Fragmentos sintéticos para citas RAG (no provienen de archivos del usuario). */
export const DEMO_SYNTHETIC_FRAGMENTS = {
  'doc-synth-plazo-pago': {
    title: 'Condiciones de pago',
    type: 'Texto',
    excerpt:
      'El plazo estándar de pago es de 30 días naturales desde la fecha de factura, salvo acuerdo comercial distinto registrado en Finanzas.',
  },
  'doc-synth-recordatorios': {
    title: 'Recordatorios amables',
    type: 'Texto',
    excerpt:
      'El primer recordatorio debe ser informativo, sin amenazas legales, e incluir el número de factura y el enlace al portal de pago autorizado.',
  },
  'doc-synth-tono': {
    title: 'Tono con clientes',
    type: 'Texto',
    excerpt: 'Usa un tono cercano y profesional; evita mayúsculas sostenidas y expresiones que presionen al cliente.',
  },
  'doc-synth-catalogo': {
    title: 'SKU A-104',
    type: 'Texto',
    excerpt: 'El producto A-104 incluye garantía de 12 meses y envío estándar en 48 h laborables.',
  },
};

export const DEMO_NEXUS_KNOWLEDGE_SOURCES = [
  {
    id: 'nxk-profit',
    name: 'Profit · carpeta documentación',
    desc: 'Documentación alojada en Profit, accesible vía Nexus cuando esté conectada.',
    status: 'pending',
  },
  {
    id: 'nxk-drive',
    name: 'Google Drive · carpeta compartida',
    desc: 'Carpeta compartida en Google Drive, accesible vía Nexus cuando esté conectada.',
    status: 'pending',
  },
];

export const DEMO_RAG_QUESTIONS = [
  {
    id: 'rag-plazo',
    label: '¿Cuál es el plazo de pago estándar?',
    needsAny: ['doc-synth-plazo-pago'],
    answer:
      'Según la política de cobro, el plazo habitual es de 30 días desde la factura.',
    cites: ['doc-synth-plazo-pago'],
  },
  {
    id: 'rag-tono',
    label: '¿Cómo debo hablar con el cliente?',
    needsAny: ['doc-synth-tono'],
    answer: 'La guía de tono recomienda un estilo cercano y profesional, sin presionar.',
    cites: ['doc-synth-tono'],
  },
  {
    id: 'rag-sku',
    label: '¿Qué garantía tiene el producto A-104?',
    needsAny: ['doc-synth-catalogo'],
    answer: 'En el catálogo, A-104 tiene 12 meses de garantía.',
    cites: ['doc-synth-catalogo'],
  },
  {
    id: 'rag-unknown',
    label: '¿Cuál es el tipo de cambio oficial de hoy?',
    needsAny: ['__none__'],
    answer: null,
    cites: [],
  },
];

let sessionBaseSeq = 0;

export function defaultDraft(partial = {}) {
  return {
    id: null,
    origin: 'custom',
    step: 1,
    dirty: false,
    mode: 'simple',
    templateKey: 'blank',
    name: '',
    icon: 'A',
    description: '',
    objective: '',
    instructions: '',
    knowledgeSkipped: false,
    _kbMode: 'existing',
    selectedBaseIds: [],
    sessionBases: [],
    externalKnowledgeSources: [],
    capabilities: [],
    approvals: { consult: true, propose: true, execute: false },
    approvalActions: [],
    childAgents: [],
    coordination: 'sequential',
    createdAt: Date.now(),
    ...partial,
  };
}

export function createSessionBase(name, description) {
  sessionBaseSeq += 1;
  return {
    id: `kb-session-${sessionBaseSeq}`,
    name: name.trim() || `Base nueva ${sessionBaseSeq}`,
    description: description.trim(),
    items: [],
  };
}

export function knowledgeSummary(draft) {
  if (draft.knowledgeSkipped) {
    return { skipped: true, bases: [], docCount: 0, externalPending: 0 };
  }
  const bases = [
    ...draft.selectedBaseIds.map((id) => DEMO_KNOWLEDGE_BASES.find((b) => b.id === id)).filter(Boolean),
    ...draft.sessionBases,
  ];
  const baseRefs = draft.selectedBaseIds.length;
  const sessionDocs = draft.sessionBases.reduce((n, b) => n + b.items.length, 0);
  const catalogDocs = draft.selectedBaseIds.reduce(
    (n, id) => n + (DEMO_KNOWLEDGE_BASES.find((b) => b.id === id)?.docCount || 0),
    0,
  );
  const externalPending = draft.externalKnowledgeSources.length;
  return {
    skipped: false,
    bases,
    baseRefs,
    sessionBases: draft.sessionBases.length,
    docCount: catalogDocs + sessionDocs,
    externalPending,
  };
}

export function reachableSyntheticDocIds(draft) {
  if (draft.knowledgeSkipped) return new Set();
  const ids = new Set();
  draft.selectedBaseIds.forEach((bid) => {
    const base = DEMO_KNOWLEDGE_BASES.find((b) => b.id === bid);
    base?.docs.forEach((d) => ids.add(d));
  });
  draft.sessionBases.forEach((base) => {
    base.items.forEach((item) => {
      if (item.syntheticKey) ids.add(item.syntheticKey);
    });
  });
  return ids;
}

export function simulateRag(draft, questionId) {
  const q = DEMO_RAG_QUESTIONS.find((x) => x.id === questionId) || DEMO_RAG_QUESTIONS[0];
  const available = reachableSyntheticDocIds(draft);
  const ragDisclaimer = 'Respuesta con citas · revisa las fuentes antes de publicar';
  if (draft.knowledgeSkipped || !available.size) {
    return {
      text: 'No hay base de conocimiento seleccionada o no hay fragmentos disponibles para responder.',
      insufficient: true,
      cites: [],
      disclaimer: ragDisclaimer,
    };
  }
  if (questionId === 'rag-unknown' || !q.needsAny.some((id) => available.has(id))) {
    return {
      text: 'No encuentro información suficiente en las bases seleccionadas para esta pregunta.',
      insufficient: true,
      cites: [],
      disclaimer: ragDisclaimer,
    };
  }
  const cites = q.cites
    .filter((id) => available.has(id))
    .map((id) => ({ id, ...DEMO_SYNTHETIC_FRAGMENTS[id] }));
  return { text: q.answer, insufficient: false, cites, disclaimer: ragDisclaimer };
}

export function statusLabel(status) {
  if (status === 'demo') return { text: 'Disponible', class: 'demo' };
  if (status === 'pending') return { text: 'Pendiente de conexión', class: 'pending' };
  return { text: 'Sin permiso', class: 'denied' };
}

export function saveDraft(draft) {
  const store = getDemoStore();
  draft.dirty = false;
  draft.origin = 'custom';
  draft.statusLabel = 'Borrador';
  if (!draft.id) {
    store.seq += 1;
    draft.id = `demo-draft-${store.seq}`;
    store.drafts.push(structuredClone(draft));
  } else {
    const idx = store.drafts.findIndex((d) => d.id === draft.id);
    if (idx >= 0) store.drafts[idx] = structuredClone(draft);
    else store.drafts.push(structuredClone(draft));
  }
  return draft.id;
}

export function loadDraft(id) {
  return getDemoStore().drafts.find((d) => d.id === id) || null;
}

export function listDrafts() {
  return [...getDemoStore().drafts];
}

export function simulateResponse(draft, scenarioId, userText) {
  const kbase = knowledgeSummary(draft);
  const uses = {
    modules: draft.capabilities.filter((c) => c.startsWith('mod-')).map((id) => DEMO_MODULES.find((m) => m.id === id)?.name).filter(Boolean),
    nexus: draft.capabilities.filter((c) => c.startsWith('nx-')).map((id) => NEXUS_INTEGRATIONS.find((m) => m.id === id)?.name).filter(Boolean),
    agents: draft.childAgents.map((id) => DEMO_PREDEFINED_AGENTS.find((a) => a.id === id)?.name).filter(Boolean),
    knowledgeBases: kbase.skipped ? ['Sin base'] : kbase.bases.map((b) => b.name),
  };
  const mode = draft.mode === 'orchestrator' ? 'orquestador' : 'agente simple';
  let body = `Como ${mode} «${draft.name || 'sin nombre'}», prepararía una respuesta según tu configuración.`;
  if (scenarioId === 'cobro') {
    body = 'Encontré 2 facturas vencidas. Propongo un recordatorio corto y amable para tu revisión antes de enviar.';
  } else if (scenarioId === 'coord') {
    body = 'Pasaría la consulta al agente Finanzas y al de Ecommerce, luego uniría ambos resúmenes en un mensaje único.';
  } else if (userText) {
    body = `Recibí: «${userText}». Analizaría permisos y fuentes autorizadas antes de responder.`;
  }
  return {
    text: body,
    uses,
    disclaimer: 'Vista previa · revisa antes de activar',
  };
}

export function pickIcon(seed) {
  const i = Math.abs([...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0)) % ICONS.length;
  return ICONS[i];
}
