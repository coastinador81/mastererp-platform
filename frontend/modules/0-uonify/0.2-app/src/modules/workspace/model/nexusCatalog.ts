/** Conexiones con flujo propio en Uonify (Google Cloud, Drive, Blender y Amazon con su configuración real). */
export const NEXUS_APPS = [
  { id: 'cloud', name: 'Google Cloud', description: 'Gemini y Vertex AI para trabajar con Uony.', category: 'Inteligencia artificial', icon: 'google-cloud.png', available: true },
  { id: 'drive', name: 'Google Drive', description: 'Tus documentos, imágenes y archivos de producto.', category: 'Archivos y contenido', icon: 'google-drive.png', available: true },
  { id: 'blender', name: 'Blender', description: 'Tu escena y sus vistas previas, en tu ordenador.', category: 'Diseño y contenido 3D', icon: 'blender-logo.svg', available: true },
  { id: 'amazon', name: 'Amazon Seller Central', description: 'Tu catálogo y tus publicaciones en Amazon.', category: 'Canales de venta', icon: 'amazon-logo.svg', available: true },
  { id: 'chatgpt', name: 'ChatGPT', description: 'Conecta tu cuenta con las herramientas de Uonify.', category: 'Inteligencia artificial', icon: 'openai-blossom.svg', available: true },
] as const;
export type NexusApp = typeof NEXUS_APPS[number];

/** Ficha de una conexión que se activa por solicitud: qué hace, qué hará Uony y qué permisos pide. */
export interface NexusRequestDetails {
  does: string;
  uony: readonly string[];
  permissions: readonly string[];
}

export type NexusPlatformId = 'meta' | 'microsoft' | 'google' | 'openai' | 'aws' | 'custom';

export interface NexusConnector extends NexusRequestDetails {
  id: string;
  platform: NexusPlatformId;
  name: string;
  description: string;
  category: string;
}

/** Plataformas del catálogo Nexus compartido con el Centro de Agentes. */
export const NEXUS_PLATFORMS: readonly { id: NexusPlatformId; name: string; mark: string; summary: string }[] = [
  { id: 'meta', name: 'Meta', mark: 'M', summary: 'Mensajería y redes sociales de tu empresa.' },
  { id: 'microsoft', name: 'Microsoft', mark: 'Mi', summary: 'Productividad, colaboración e IA en Microsoft 365 y Azure.' },
  { id: 'google', name: 'Google', mark: 'G', summary: 'Correo, archivos, calendario y modelos de Google Cloud.' },
  { id: 'openai', name: 'OpenAI', mark: 'O', summary: 'Modelos de IA mediante API con claves custodiadas.' },
  { id: 'aws', name: 'AWS', mark: 'A', summary: 'Servicios gestionados en Amazon Web Services.' },
  { id: 'custom', name: 'Integraciones personalizadas', mark: '+', summary: 'APIs y eventos definidos por tu organización.' },
];

const SOCIAL = 'Mensajería y redes sociales';
const WORK = 'Productividad y colaboración';
const FILES = 'Archivos y contenido';
const AI = 'Inteligencia artificial';
const MAIL = 'Correo y notificaciones';
const CUSTOM = 'Integraciones a medida';

const meta = (id: string, name: string, does: string, uony: string[]): NexusConnector => ({
  id: `meta-${id}`, platform: 'meta', name, category: SOCIAL,
  description: `Atiende y conversa con tus clientes en ${name}.`, does, uony,
  permissions: ['Leer y enviar mensajes de los canales que autorices', 'Usar las plantillas aprobadas por Meta', 'Recibir avisos de nuevos mensajes'],
});

/** Los 22 conectores del catálogo Nexus, agrupados por plataforma. */
export const NEXUS_CONNECTORS: readonly NexusConnector[] = [
  meta('whatsapp', 'WhatsApp Business', 'Conecta tu número de WhatsApp Business para atender a clientes desde Uonify.', ['Responder consultas de producto y pedidos', 'Enviar avisos con plantillas aprobadas', 'Resumir conversaciones para tu equipo']),
  meta('instagram', 'Instagram', 'Conecta la cuenta profesional de Instagram de tu marca.', ['Responder mensajes directos', 'Preparar publicaciones con tu contenido de Estudio', 'Detectar consultas de compra']),
  meta('facebook', 'Facebook', 'Conecta la página de Facebook de tu empresa.', ['Responder mensajes de la página', 'Preparar publicaciones de tus productos', 'Resumir la actividad de tus clientes']),
  meta('messenger', 'Messenger', 'Conecta Messenger para conversar con los clientes de tu página.', ['Atender conversaciones en tiempo real', 'Derivar a tu equipo los casos que lo requieran', 'Enviar respuestas con el tono de tu marca']),
  { id: 'ms-365', platform: 'microsoft', name: 'Microsoft 365', category: WORK, description: 'Identidad, correo y colaboración de tu organización.', does: 'Conecta el tenant de Microsoft 365 de tu empresa con Uonify.', uony: ['Iniciar sesión con tu cuenta de empresa', 'Coordinar tareas entre Uonify y tus herramientas de Microsoft'], permissions: ['Leer tu perfil básico', 'Consultar tu calendario', 'Acceder a los archivos de OneDrive que elijas'] },
  { id: 'ms-outlook', platform: 'microsoft', name: 'Outlook', category: MAIL, description: 'Correo y bandejas compartidas.', does: 'Conecta tu buzón de Outlook para trabajar el correo con Uony.', uony: ['Redactar y enviar correos que tú apruebes', 'Resumir hilos largos', 'Recordarte pagos y respuestas pendientes'], permissions: ['Leer los hilos de las carpetas que autorices', 'Enviar correo en tu nombre tras tu confirmación'] },
  { id: 'ms-teams', platform: 'microsoft', name: 'Teams', category: WORK, description: 'Canales y colaboración de tu equipo.', does: 'Conecta Microsoft Teams para que Uony participe en tus canales.', uony: ['Enviar avisos a los canales de tu equipo', 'Resumir conversaciones y menciones'], permissions: ['Publicar mensajes en los canales elegidos', 'Leer las menciones a Uony'] },
  { id: 'ms-sharepoint', platform: 'microsoft', name: 'SharePoint', category: FILES, description: 'Sitios y bibliotecas de documentación.', does: 'Conecta los sitios de SharePoint donde guardas tu documentación.', uony: ['Buscar y resumir documentación interna', 'Usar tus fichas y manuales como contexto'], permissions: ['Leer las listas y bibliotecas del sitio autorizado', 'Consultar los metadatos de los archivos'] },
  { id: 'ms-onedrive', platform: 'microsoft', name: 'OneDrive', category: FILES, description: 'Tus archivos personales y compartidos.', does: 'Conecta OneDrive for Business para usar tus archivos en Uonify.', uony: ['Guardar resultados en tus carpetas', 'Usar imágenes y documentos como referencia'], permissions: ['Leer y escribir solo en las carpetas que apruebes'] },
  { id: 'ms-azure-ai', platform: 'microsoft', name: 'Azure AI', category: AI, description: 'Servicios y modelos de IA en Azure.', does: 'Conecta tus recursos de Azure AI para usarlos desde Uony.', uony: ['Usar tus modelos de Azure en tus flujos', 'Generar embeddings para tu conocimiento'], permissions: ['Invocar los recursos de Azure AI que indiques', 'Leer el estado de tu suscripción'] },
  { id: 'g-workspace', platform: 'google', name: 'Google Workspace', category: WORK, description: 'Identidad y colaboración de tu dominio Google.', does: 'Conecta el dominio de Google Workspace de tu empresa.', uony: ['Iniciar sesión con tu cuenta de empresa', 'Reconocer a las personas de tu equipo'], permissions: ['Leer tu perfil', 'Consultar el directorio de tu organización'] },
  { id: 'g-gmail', platform: 'google', name: 'Gmail', category: MAIL, description: 'Correo de empresa con Gmail.', does: 'Conecta Gmail para gestionar el correo con Uony.', uony: ['Redactar respuestas que tú apruebes', 'Enviar recordatorios a tus clientes', 'Ordenar el correo por etiquetas'], permissions: ['Leer las etiquetas que autorices', 'Enviar correo tras tu confirmación'] },
  { id: 'g-drive', platform: 'google', name: 'Unidades compartidas de Drive', category: FILES, description: 'Carpetas compartidas de tu organización.', does: 'Conecta las unidades compartidas de Google Drive de tu equipo.', uony: ['Trabajar con la documentación común del equipo', 'Guardar entregas en carpetas compartidas'], permissions: ['Leer los archivos de las unidades que elijas', 'Crear archivos en las carpetas aprobadas'] },
  { id: 'g-calendar', platform: 'google', name: 'Google Calendar', category: WORK, description: 'Calendarios, citas y disponibilidad.', does: 'Conecta Google Calendar para organizar citas desde Uonify.', uony: ['Proponer citas con clientes', 'Recordarte entregas y lanzamientos'], permissions: ['Leer tu disponibilidad', 'Crear eventos tras tu confirmación'] },
  { id: 'g-gemini', platform: 'google', name: 'Gemini API', category: AI, description: 'Modelos Gemini para texto e imagen.', does: 'Conecta tu clave de Gemini API para tus propios flujos.', uony: ['Generar textos y descripciones', 'Analizar imágenes y documentos'], permissions: ['Usar tu proyecto con la Gemini API habilitada'] },
  { id: 'g-vertex', platform: 'google', name: 'Vertex AI', category: AI, description: 'Plataforma de IA en Google Cloud.', does: 'Conecta Vertex AI para búsqueda y modelos a medida.', uony: ['Buscar en tu conocimiento con RAG', 'Usar modelos ajustados a tu negocio'], permissions: ['Invocar predicciones en tu proyecto', 'Leer y crear índices autorizados'] },
  { id: 'openai-api', platform: 'openai', name: 'OpenAI API', category: AI, description: 'Modelos de OpenAI con claves custodiadas.', does: 'Conecta tu organización de OpenAI con la clave custodiada en Nexus.', uony: ['Usar modelos de OpenAI en tus agentes', 'Generar embeddings', 'Moderar contenido'], permissions: ['Usar tu clave de API, guardada cifrada y rotable'] },
  { id: 'aws-bedrock', platform: 'aws', name: 'Amazon Bedrock', category: AI, description: 'Modelos fundacionales en AWS.', does: 'Conecta Amazon Bedrock para usar sus modelos desde Uonify.', uony: ['Usar modelos de Bedrock en tus agentes', 'Consultar tus bases de conocimiento'], permissions: ['Invocar modelos en la región que elijas', 'Leer tus bases de conocimiento'] },
  { id: 'aws-ses', platform: 'aws', name: 'Amazon SES', category: MAIL, description: 'Correo transaccional a escala.', does: 'Conecta Amazon SES para enviar correo desde tu dominio.', uony: ['Enviar notificaciones a tus clientes', 'Usar tus plantillas de correo'], permissions: ['Enviar correo desde tu dominio verificado', 'Usar tus plantillas'] },
  { id: 'aws-s3', platform: 'aws', name: 'Amazon S3', category: FILES, description: 'Almacenamiento de objetos en AWS.', does: 'Conecta tus buckets de Amazon S3 para guardar y leer archivos.', uony: ['Guardar resultados en tu almacenamiento', 'Usar tus archivos como referencia'], permissions: ['Leer y escribir solo en los prefijos autorizados'] },
  { id: 'custom-api', platform: 'custom', name: 'APIs REST', category: CUSTOM, description: 'Las APIs propias de tu organización.', does: 'Conecta las APIs de tu empresa a partir de su especificación OpenAPI.', uony: ['Consultar tus sistemas internos', 'Ejecutar acciones que tú apruebes'], permissions: ['Autenticarse con OAuth de cliente, clave o certificado', 'Llamar solo a las operaciones declaradas'] },
  { id: 'custom-webhook', platform: 'custom', name: 'Webhooks', category: CUSTOM, description: 'Eventos HTTP de tus sistemas.', does: 'Recibe en Uonify los eventos que envían tus sistemas.', uony: ['Reaccionar a pedidos, altas y cambios', 'Avisarte de lo que necesita tu atención'], permissions: ['Recibir eventos firmados con HMAC', 'Reintentar entregas fallidas'] },
];

/** Ficha de solicitud de las conexiones destacadas sin flujo propio activo. */
export const NEXUS_FEATURED_REQUEST: Record<'amazon' | 'chatgpt', NexusRequestDetails> = {
  amazon: { does: 'Conecta tu cuenta de Amazon Seller Central para gestionar tu catálogo desde Uonify.', uony: ['Preparar y mejorar tus fichas de producto', 'Revisar el estado de tus publicaciones', 'Detectar fichas incompletas'], permissions: ['Leer tu catálogo y tus publicaciones', 'Actualizar fichas tras tu confirmación'] },
  chatgpt: { does: 'Conecta tu cuenta de ChatGPT con las herramientas de Uonify.', uony: ['Usar Uonify desde tus conversaciones en ChatGPT', 'Llevar tus resultados de ChatGPT a tu espacio'], permissions: ['Identificar tu cuenta de ChatGPT', 'Acceder solo a las herramientas de Uonify que autorices'] },
};
