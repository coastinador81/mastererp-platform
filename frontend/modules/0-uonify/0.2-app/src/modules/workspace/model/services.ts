/**
 * Servicios de Uonify y su correspondencia con las rutas del espacio de trabajo.
 * Origen: `services` de app-shell.js del prototipo. En el PROTO el servicio activo
 * y su vista vivían en el estado (`activeService`, `serviceView`); en React son la
 * URL: /espacio/<servicio>[/<vista>]. Producto (catálogo y ficha) lo pinta el
 * módulo catalog en /espacio/producto…; el resto de vistas, este módulo.
 */
export type ServiceId =
  | 'erp'
  | 'producto'
  | 'analitica'
  | 'auditoria'
  | 'agentes'
  | 'academy'
  | 'logistica'
  | 'fabrica'
  | 'nexus';

export interface ServiceInfo {
  name: string;
  icon: string;
  description: string;
  /** Vacío de la vista genérica (los servicios sin vista propia). */
  title?: string;
  detail?: string;
  /** Capacidades que presenta la página del servicio. */
  capabilities?: string[];
}

export const SERVICES: Record<ServiceId, ServiceInfo> = {
  erp: { name: 'ERP', icon: 'erp.png', description: 'Inventario, compras, ventas y finanzas coordinados en un mismo lugar.', title: 'Conecta tu operación', detail: 'Empieza vinculando las fuentes con las que trabaja tu empresa.', capabilities: ['Inventario y existencias por almacén', 'Compras, ventas y proveedores', 'Finanzas y tesorería', 'Informes de operación'] },
  producto: { name: 'Producto', icon: 'catalogo.png', description: 'Crea, importa y prepara tus fichas de producto para cada canal.' },
  analitica: { name: 'Analítica', icon: 'analitica.png', description: 'Consulta el rendimiento de tus productos, canales y operaciones.', title: 'Reúne tus datos', detail: 'Conecta tus canales para ver sus resultados en una misma vista.', capabilities: ['Rendimiento por producto y canal', 'Ventas, márgenes y tendencias', 'Alertas cuando algo cambia', 'Informes listos para compartir'] },
  auditoria: { name: 'Captura y auditoría', icon: 'auditoria.png', description: 'Reúne información de origen y revisa la calidad de cada ficha.', title: 'Revisa tus productos', detail: 'Selecciona productos del catálogo para detectar vacíos y contrastar fuentes.', capabilities: ['Captura de datos de origen', 'Detección de campos vacíos o incoherentes', 'Contraste de fuentes por ficha', 'Recomendaciones de mejora con Uony'] },
  agentes: { name: 'Agentes', icon: 'hive.png', description: 'Coordina tareas con acceso controlado a los servicios de Uonify.', title: 'Organiza tus agentes', detail: 'Define sus herramientas, permisos y acciones que requieren aprobación.', capabilities: ['Agentes con herramientas y permisos definidos', 'Acciones que requieren tu aprobación', 'Historial de cada tarea', 'Coordinación con todos los servicios'] },
  academy: { name: 'Academy', icon: 'academy.png', description: 'Conocimiento y formación para los equipos que operan en Uonify.', title: 'Construye el aprendizaje de tu equipo', detail: 'Organiza recursos y recorridos por proyecto o función.', capabilities: ['Recorridos de formación por función', 'Guías de cada servicio de Uonify', 'Recursos de tu equipo en un solo lugar', 'Seguimiento del aprendizaje'] },
  logistica: { name: 'Logística', icon: 'logistica.png', description: 'Coordina preparación, envíos y seguimiento.', title: 'Conecta tus operaciones logísticas', detail: 'Reúne tus flujos de entrega y consulta su estado en un solo lugar.', capabilities: ['Preparación de pedidos', 'Envíos y transportistas', 'Seguimiento de entregas', 'Incidencias y devoluciones'] },
  fabrica: { name: 'Fábrica y proveedores', icon: 'fabrica.png', description: 'Trabaja con proveedores y datos de fabricación.', title: 'Organiza tu red de proveedores', detail: 'Centraliza la información que necesitas para colaborar con ellos.', capabilities: ['Fichas de proveedores y fabricantes', 'Datos técnicos y de fabricación', 'Pedidos y plazos de producción', 'Documentación compartida'] },
  nexus: { name: 'Nexus', icon: 'nexus.png', description: 'Conecta canales y herramientas con tu espacio Uonify.' },
};

/** Orden de la rejilla del menú de servicios (plantilla #view-espacio). */
export const SERVICE_ORDER: ServiceId[] = ['erp', 'producto', 'analitica', 'auditoria', 'agentes', 'academy', 'logistica', 'fabrica', 'nexus'];

/** Servicios cuya vista pinta este módulo (Producto es del módulo catalog). */
export const WORKSPACE_VIEW_SERVICES: ServiceId[] = SERVICE_ORDER.filter(service => service !== 'producto');

/** Canales de Nexus con vista de conexión propia (/espacio/nexus/<canal>). */
export const NEXUS_CHANNELS = ['amazon', 'shopify'] as const;
export type NexusChannel = (typeof NEXUS_CHANNELS)[number];

export const WORKSPACE_PATH = '/espacio';
/** Vista «nuevo producto» del PROTO (`serviceView: 'new-product'`) → /espacio/producto/nuevo. */
export const PRODUCT_NEW_SEGMENT = 'nuevo';
export const NEW_PRODUCT_VIEW = 'new-product';
export const DEFAULT_VIEW = 'default';

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === 'string' && Object.hasOwn(SERVICES, value);
}

export function isNexusChannel(value: unknown): value is NexusChannel {
  return typeof value === 'string' && (NEXUS_CHANNELS as readonly string[]).includes(value);
}

/** Icono del servicio (recursos del PROTO copiados en public/assets). */
export function serviceIcon(service: ServiceId): string {
  return `/assets/product-icons/${SERVICES[service].icon}`;
}

/** Estado de un servicio en el catálogo: disponible o «Próximamente». */
export type ServiceCatalogStatus = 'active' | 'soon';
/** Id del catálogo: un servicio del espacio o «estudio» (acceso directo al chat, sin vista de módulo). */
export type CatalogServiceId = ServiceId | 'estudio';

export interface ServiceCatalogEntry {
  id: CatalogServiceId;
  name: string;
  /** Ruta del icono en public/assets/product-icons. */
  iconSrc: string;
  status: ServiceCatalogStatus;
}

/** Icono de una entrada del catálogo (Estudio tiene icono propio y no es un ServiceId del espacio). */
export function catalogIconSrc(id: CatalogServiceId): string {
  return id === 'estudio' ? '/assets/product-icons/estudio.png' : serviceIcon(id);
}

const ACTIVE_CATALOG: CatalogServiceId[] = ['producto', 'estudio', 'erp', 'nexus', 'analitica', 'auditoria', 'agentes', 'academy', 'logistica', 'fabrica'];
const SOON_CATALOG: CatalogServiceId[] = [];

/**
 * Fuente única de los servicios que muestran el lanzador del espacio (ServicesMenu)
 * y el panel de la Home (ToolsPanel), con su estado. Orden: Producto, Estudio, ERP,
 * Nexus y el resto. Desde el 10-11-2026 todos están activos (orden del dueño: ningún
 * «Próximamente»); para volver a marcar uno como próximo, basta con pasarlo a
 * SOON_CATALOG y los dos paneles lo pintan igual. Nombre e icono salen de SERVICES;
 * Estudio es un acceso directo al chat, con icono propio y sin vista de módulo.
 */
export const SERVICE_CATALOG: ServiceCatalogEntry[] = [...ACTIVE_CATALOG, ...SOON_CATALOG].map(id => ({
  id,
  name: id === 'estudio' ? 'Estudio' : SERVICES[id].name,
  iconSrc: catalogIconSrc(id),
  status: ACTIVE_CATALOG.includes(id) ? 'active' : 'soon',
}));

/** Ruta de un servicio y su vista (equivale a `selectService(service, view)` del PROTO). */
export function servicePath(service: ServiceId | null, view: string = DEFAULT_VIEW): string {
  if (!service) return WORKSPACE_PATH;
  const base = `${WORKSPACE_PATH}/${service}`;
  if (service === 'producto') return view === NEW_PRODUCT_VIEW ? `${base}/${PRODUCT_NEW_SEGMENT}` : base;
  if (service === 'nexus' && isNexusChannel(view)) return `${base}/${view}`;
  return base;
}

/** Lo que el PROTO guardaba en el estado, leído de la URL del espacio. */
export interface WorkspaceRoute {
  pathname: string;
  service: ServiceId | null;
  view: string;
  /** Producto con ficha abierta (nuevo o elegido): /espacio/producto/<algo>. */
  hasSheet: boolean;
}

export function parseWorkspacePath(pathname: string): WorkspaceRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const [first, second] = clean.startsWith(`${WORKSPACE_PATH}/`) ? clean.slice(WORKSPACE_PATH.length + 1).split('/') : [];
  if (!isServiceId(first)) return { pathname: clean, service: null, view: DEFAULT_VIEW, hasSheet: false };
  let view = DEFAULT_VIEW;
  if (first === 'producto' && second === PRODUCT_NEW_SEGMENT) view = NEW_PRODUCT_VIEW;
  if (first === 'nexus' && isNexusChannel(second)) view = second;
  return { pathname: clean, service: first, view, hasSheet: first === 'producto' && Boolean(second) };
}

/** Clave de pantalla del PROTO (`screenKey`), para la animación de entrada. */
export function screenKey(route: Pick<WorkspaceRoute, 'service' | 'view'>, activeThreadId: string | null): string {
  if (route.service) return route.service === 'producto' ? 'producto' : `${route.service}:${route.view}`;
  return activeThreadId ? `chat:${activeThreadId}` : 'home';
}
