/**
 * Servicio Agentes: apartados del menú, los 10 agentes predeterminados por módulo y las
 * integraciones que se pueden pedir para un agente. Textos y orden del Centro de Agentes
 * del equipo (frontend/modules/2.6-agent-center/agents-web: index.html,
 * agents-catalog-demo.mjs, configuracion.html y nexus-catalog.mjs).
 */
export type AgentMode = 'simple' | 'orchestrator';

export const MODE_LABEL: Record<AgentMode, string> = {
  simple: 'Agente simple',
  orchestrator: 'Coordinador',
};

export interface PredefinedAgent {
  /** Segmento de la ruta: /espacio/agentes/predeterminados/<id>. */
  id: string;
  name: string;
  module: string;
  mode: AgentMode;
  summary: string;
}

const agent = (id: string, name: string, mode: AgentMode, summary: string): PredefinedAgent => ({ id, name, module: name, mode, summary });

export const PREDEFINED_AGENTS: readonly PredefinedAgent[] = [
  agent('finanzas', 'Finanzas', 'simple', 'Consulta partidas, prepara recordatorios de cobro y sigue las condiciones de pago.'),
  agent('ecommerce', 'Ecommerce', 'simple', 'Catálogo, pedidos y estado de las ventas en tus canales.'),
  agent('inventario', 'Inventario', 'simple', 'Existencias, movimientos de almacén y avisos de reposición.'),
  agent('crm', 'CRM', 'orchestrator', 'Coordina contactos, oportunidades y el seguimiento comercial.'),
  agent('marketing', 'Marketing', 'simple', 'Campañas, audiencias y calendario de publicaciones.'),
  agent('servicios', 'Servicios', 'simple', 'Solicitudes de clientes, citas y seguimiento de cada servicio.'),
  agent('transporte', 'Transporte', 'simple', 'Envíos, rutas y estado de las entregas.'),
  agent('productividad', 'Productividad', 'orchestrator', 'Reparte tareas entre agentes y equipos y vigila los plazos.'),
  agent('punto-de-venta', 'Punto de venta', 'simple', 'Ventas en tienda, cierres de caja y devoluciones.'),
  agent('estudio', 'Estudio', 'simple', 'Piezas de imagen y vídeo para tus productos y campañas.'),
];

export const findPredefined = (id: string | undefined) => PREDEFINED_AGENTS.find(item => item.id === id) ?? null;

/** Apartados del menú (vista=… del Centro de Agentes). */
export type SectionId = 'inicio' | 'predeterminados' | 'personalizados' | 'conocimiento' | 'flujos' | 'aprobaciones' | 'integraciones' | 'supervision';

/** Acción principal de un apartado sin contenido todavía. */
export type SectionAction = 'crear-agente' | 'abrir-predeterminados' | 'hablar-con-uony';

export interface Section {
  id: SectionId;
  label: string;
  icon: AgentIconName;
  /** Frase del equipo bajo el título. */
  lead: string;
  /** Estado vacío y su acción (solo en los apartados sin lista propia). */
  empty?: { title: string; text: string; action: string; does: SectionAction };
}

export type AgentIconName = 'home' | 'agents' | 'custom' | 'knowledge' | 'flow' | 'approval' | 'plug' | 'monitor' | 'spark';

export const SECTIONS: readonly Section[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home', lead: 'Configura agentes, conocimiento y reglas de negocio para que cada acción siga la forma de trabajar de tu empresa.' },
  { id: 'predeterminados', label: 'Agentes predeterminados', icon: 'agents', lead: 'Agentes preparados para los procesos habituales de tu empresa, uno por módulo.' },
  { id: 'personalizados', label: 'Agentes personalizados', icon: 'custom', lead: 'Los agentes que creas para tus propios procesos.' },
  {
    id: 'conocimiento', label: 'Conocimiento y reglas', icon: 'knowledge',
    lead: 'Centraliza documentos, políticas y reglas de negocio para que los agentes actúen con contexto y límites claros.',
    empty: { title: 'Aún no hay conocimiento publicado', text: 'Añade documentos, políticas y reglas al crear o afinar un agente; aparecerán aquí para que todos los agentes los respeten.', action: 'Añadir conocimiento', does: 'crear-agente' },
  },
  {
    id: 'flujos', label: 'Flujos y tareas', icon: 'flow',
    lead: 'Coordina pasos, responsables y resultados entre tus agentes y equipos.',
    empty: { title: 'Aún no hay flujos', text: 'Describe a Uony el proceso que quieres automatizar y te propondrá los pasos, los responsables y las revisiones.', action: 'Crear flujo con Uony', does: 'hablar-con-uony' },
  },
  {
    id: 'aprobaciones', label: 'Aprobaciones', icon: 'approval',
    lead: 'Las decisiones sensibles aparecen aquí antes de que un agente las ejecute.',
    empty: { title: 'Nada requiere tu revisión', text: 'Cuando un agente necesite tu visto bueno para una acción sensible, la verás aquí con su contexto.', action: 'Revisar permisos de los agentes', does: 'abrir-predeterminados' },
  },
  { id: 'integraciones', label: 'Integraciones y canales', icon: 'plug', lead: 'Conecta tus herramientas de negocio y los canales autorizados para cada agente.' },
  {
    id: 'supervision', label: 'Supervisión', icon: 'monitor',
    lead: 'Consulta la actividad, las decisiones y los resultados de tus agentes con total trazabilidad.',
    empty: { title: 'Todo está al día', text: 'Cuando los agentes empiecen a trabajar, verás aquí sus decisiones, sus resultados y las revisiones que necesiten.', action: 'Hablar con Uony', does: 'hablar-con-uony' },
  },
];

export const findSection = (id: string | undefined) => SECTIONS.find(item => item.id === id) ?? null;

/** Apartados que abren su lista en el panel lateral (los demás, en el centro). */
export const LIST_SECTIONS: readonly SectionId[] = ['predeterminados', 'personalizados'];

export interface Integration {
  id: string;
  platform: string;
  name: string;
  summary: string;
}

const integration = (platform: string, id: string, name: string, summary: string): Integration => ({ id, platform, name, summary });

/** Servicios de Nexus disponibles para los agentes (nexus-catalog.mjs). */
export const INTEGRATIONS: readonly Integration[] = [
  integration('Meta', 'meta-whatsapp', 'WhatsApp', 'Mensajería con clientes mediante plantillas aprobadas.'),
  integration('Meta', 'meta-instagram', 'Instagram', 'Mensajes y comentarios de tu cuenta comercial.'),
  integration('Meta', 'meta-facebook', 'Facebook', 'Páginas y conversaciones de tu empresa.'),
  integration('Meta', 'meta-messenger', 'Messenger', 'Atención al cliente por Messenger.'),
  integration('Microsoft', 'ms-365', 'Microsoft 365', 'Identidad, correo y colaboración.'),
  integration('Microsoft', 'ms-outlook', 'Outlook', 'Correo y bandeja compartida.'),
  integration('Microsoft', 'ms-teams', 'Teams', 'Colaboración y canales internos.'),
  integration('Microsoft', 'ms-sharepoint', 'SharePoint', 'Bibliotecas y sitios de documentación.'),
  integration('Microsoft', 'ms-onedrive', 'OneDrive', 'Archivos personales y compartidos.'),
  integration('Microsoft', 'ms-azure-ai', 'Azure AI', 'Servicios cognitivos y modelos en Azure.'),
  integration('Google', 'g-workspace', 'Google Workspace', 'Identidad, correo y colaboración de Google.'),
  integration('Google', 'g-gmail', 'Gmail', 'Correo empresarial.'),
  integration('Google', 'g-drive', 'Drive', 'Almacenamiento y archivos compartidos.'),
  integration('Google', 'g-calendar', 'Calendar', 'Calendarios y disponibilidad.'),
  integration('Google', 'g-gemini', 'Gemini', 'Modelos Gemini de Google.'),
  integration('Google', 'g-vertex', 'Vertex AI', 'Plataforma de IA en Google Cloud.'),
  integration('OpenAI', 'openai-api', 'OpenAI API', 'Capacidades de IA mediante API.'),
  integration('AWS', 'aws-bedrock', 'Amazon Bedrock', 'Modelos fundacionales en AWS.'),
  integration('AWS', 'aws-ses', 'Amazon SES', 'Correo transaccional.'),
  integration('AWS', 'aws-s3', 'Amazon S3', 'Almacenamiento de objetos.'),
  integration('Personalizadas', 'custom-api', 'APIs REST', 'Consume APIs definidas por tu organización.'),
  integration('Personalizadas', 'custom-webhook', 'Webhooks', 'Recibe eventos HTTP en endpoints registrados.'),
];

export const findIntegration = (id: string) => INTEGRATIONS.find(item => item.id === id) ?? null;

/** Trazos de línea (1,5) de los iconos del menú, como los de Finanzas. */
export const AGENT_ICON_PATHS: Record<AgentIconName, string> = {
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z"/>',
  agents: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 4v3M9 12h.01M15 12h.01M9.5 15h5"/>',
  custom: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4"/><circle cx="12" cy="12" r="3"/>',
  knowledge: '<path d="M5 4h10l4 4v12H5V4Zm10 0v4h4M8 12h8m-8 4h6"/>',
  flow: '<rect x="3" y="4" width="6" height="5" rx="1.5"/><rect x="15" y="15" width="6" height="5" rx="1.5"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/>',
  approval: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  plug: '<path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v5"/>',
  monitor: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  spark: '<path d="M12 3v4m0 10v4M5 12H3m18 0h-2M7 7 5.5 5.5m13 13L17 17M17 7l1.5-1.5m-13 13L7 17"/>',
};
