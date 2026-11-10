/** Catálogo de integraciones Nexus (fuente compartida con Centro de Agentes). */

export const PLATFORMS = [
  { id: 'meta', name: 'Meta', mark: 'M', summary: 'Canales de mensajería y redes sociales empresariales.' },
  { id: 'microsoft', name: 'Microsoft', mark: 'Mi', summary: 'Productividad, colaboración e IA en Microsoft 365 y Azure.' },
  { id: 'google', name: 'Google', mark: 'G', summary: 'Correo, archivos, calendario y modelos de Google Cloud.' },
  { id: 'openai', name: 'OpenAI', mark: 'O', summary: 'Capacidades de IA mediante API con claves gestionadas en Nexus.' },
  { id: 'aws', name: 'AWS', mark: 'A', summary: 'Servicios gestionados en Amazon Web Services.' },
  { id: 'custom', name: 'Integraciones personalizadas', mark: '+', summary: 'APIs REST, webhooks y conectores definidos por tu organización.' },
];

const pending = 'Pendiente de configuración';

function svc(platformId, id, name, description, uses, capabilities, requirements, connectors = []) {
  const implemented = connectors.some((c) => c.implemented);
  return {
    id,
    platformId,
    name,
    description,
    uses,
    capabilities,
    requirements,
    connectors: connectors.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.implemented ? 'Disponible' : 'Listo para configurar',
      implemented: Boolean(c.implemented),
    })),
    availability: pending,
    canAddConnection: true,
    configuredConnections: [],
  };
}

export const SERVICES = [
  ...['WhatsApp Business', 'Instagram', 'Facebook', 'Messenger'].map((name, i) =>
    svc(
      'meta',
      `meta-${['whatsapp', 'instagram', 'facebook', 'messenger'][i]}`,
      name,
      `Integración con ${name} para canales autorizados por tu empresa.`,
      ['Centro de Agentes', 'Atención al cliente', 'Campañas salientes'],
      ['Mensajería', 'Plantillas aprobadas', 'Webhooks de eventos'],
      ['Cuenta comercial verificada', 'Políticas de uso de Meta cumplidas'],
      [{ id: 'meta-graph', name: 'Graph API · conector estándar', implemented: false }],
    ),
  ),
  svc(
    'microsoft',
    'ms-365',
    'Microsoft 365',
    'Suite completa para identidad, correo y colaboración.',
    ['Inicio de sesión único', 'Automatización entre módulos'],
    ['Lectura de perfil', 'Calendario compartido', 'Archivos en OneDrive'],
    ['Tenant de Microsoft Entra ID', 'Permisos de administrador de aplicaciones'],
    [{ id: 'ms-graph', name: 'Microsoft Graph', implemented: false }],
  ),
  svc('microsoft', 'ms-outlook', 'Outlook', 'Correo y bandeja compartida.', ['Notificaciones', 'Agentes de cobro'], ['Envío de correo', 'Lectura de hilos'], ['Buzón con licencia M365'], [{ id: 'ms-graph-mail', name: 'Microsoft Graph · Mail', implemented: false }]),
  svc('microsoft', 'ms-teams', 'Teams', 'Colaboración y canales internos.', ['Alertas a equipos'], ['Mensajes en canal', 'Menciones'], ['Teams habilitado en el tenant'], [{ id: 'ms-graph-teams', name: 'Microsoft Graph · Teams', implemented: false }]),
  svc('microsoft', 'ms-sharepoint', 'SharePoint', 'Bibliotecas y sitios de documentación.', ['Centro de Documentación'], ['Lectura de listas', 'Metadatos de archivos'], ['Sitio autorizado'], [{ id: 'ms-graph-sp', name: 'Microsoft Graph · SharePoint', implemented: false }]),
  svc('microsoft', 'ms-onedrive', 'OneDrive', 'Archivos personales y compartidos.', ['Respaldo de adjuntos'], ['Lectura y escritura en carpetas aprobadas'], ['Cuenta OneDrive for Business'], [{ id: 'ms-graph-drive', name: 'Microsoft Graph · OneDrive', implemented: false }]),
  svc('microsoft', 'ms-azure-ai', 'Azure AI', 'Servicios cognitivos y modelos en Azure.', ['Centro de Agentes'], ['Inferencia', 'Embeddings'], ['Suscripción Azure', 'Recurso de Azure OpenAI o Cognitive Services'], [{ id: 'ms-azure-ai', name: 'Azure AI · REST', implemented: false }]),
  svc('google', 'g-workspace', 'Google Workspace', 'Identidad, correo y colaboración de Google.', ['SSO empresarial'], ['Perfil', 'Directorio'], ['Dominio Workspace verificado'], [{ id: 'google-admin', name: 'Admin SDK', implemented: false }]),
  svc('google', 'g-gmail', 'Gmail', 'Correo empresarial vía Gmail API.', ['Recordatorios por email'], ['Envío', 'Lectura de etiquetas'], ['OAuth de organización'], [{ id: 'gmail-api', name: 'Gmail API', implemented: false }]),
  svc('google', 'g-drive', 'Drive', 'Almacenamiento y archivos compartidos.', ['Documentación'], ['Lectura de archivos', 'Carpetas compartidas'], ['Ámbito drive.readonly o superior aprobado'], [{ id: 'drive-api', name: 'Google Drive API', implemented: false }]),
  svc('google', 'g-calendar', 'Calendar', 'Calendarios y disponibilidad.', ['Citas con clientes'], ['Eventos', 'Recordatorios'], ['Calendario de servicio o delegado'], [{ id: 'calendar-api', name: 'Google Calendar API', implemented: false }]),
  svc('google', 'g-gemini', 'Gemini', 'Modelos Gemini de Google.', ['Agentes con lenguaje'], ['Generación de texto', 'Multimodal'], ['Proyecto Google Cloud', 'API habilitada'], [{ id: 'gemini-api', name: 'Gemini API', implemented: false }]),
  svc('google', 'g-vertex', 'Vertex AI', 'Plataforma de IA en Google Cloud.', ['RAG y fine-tuning'], ['Predicción', 'Indexación'], ['Proyecto GCP', 'Vertex habilitado'], [{ id: 'vertex-api', name: 'Vertex AI API', implemented: false }]),
  svc('openai', 'openai-api', 'OpenAI API', 'Capacidades de IA mediante API y claves rotables.', ['Centro de Agentes', 'Flujos conversacionales'], ['Chat completions', 'Embeddings', 'Moderación'], ['Organización OpenAI', 'Política de uso aceptada'], [{ id: 'openai-rest', name: 'REST API · clave en bóveda Nexus', implemented: false }]),
  svc('aws', 'aws-bedrock', 'Amazon Bedrock', 'Modelos fundacionales en AWS.', ['Agentes'], ['Inferencia', 'Knowledge bases'], ['Cuenta AWS', 'Bedrock habilitado en la región'], [{ id: 'aws-bedrock', name: 'AWS SDK · Bedrock', implemented: false }]),
  svc('aws', 'aws-ses', 'Amazon SES', 'Correo transaccional.', ['Notificaciones'], ['Envío', 'Plantillas'], ['Dominio verificado en SES'], [{ id: 'aws-ses', name: 'AWS SDK · SES', implemented: false }]),
  svc('aws', 'aws-s3', 'Amazon S3', 'Almacenamiento de objetos.', ['Archivos de integración'], ['Lectura', 'Escritura en prefijos autorizados'], ['Bucket y política IAM'], [{ id: 'aws-s3', name: 'AWS SDK · S3', implemented: false }]),
  svc('custom', 'custom-api', 'APIs REST', 'Expone y consume APIs definidas por tu organización.', ['Integraciones a medida'], ['Autenticación básica, OAuth cliente o certificados'], ['Especificación OpenAPI', 'Responsable de seguridad'], [{ id: 'custom-rest', name: 'Plantilla REST', implemented: false }]),
  svc('custom', 'custom-webhook', 'Webhooks', 'Recibe eventos HTTP en endpoints registrados.', ['Automatización'], ['Firma HMAC', 'Reintentos'], ['URL pública o túnel aprobado', 'Secreto de firma'], [{ id: 'custom-hook', name: 'Recepción webhook', implemented: false }]),
];

export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id);
}

export function serviceById(id) {
  return SERVICES.find((s) => s.id === id);
}

export function searchServices(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [...SERVICES];
  return SERVICES.filter((s) => {
    const platform = platformById(s.platformId);
    const blob = [s.name, s.description, platform?.name, ...s.uses, ...s.capabilities].join(' ').toLowerCase();
    return blob.includes(q);
  });
}

export function nexusCapabilityId(serviceId) {
  return `nx-${serviceId}`;
}
