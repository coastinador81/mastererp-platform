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
}

export const SERVICES: Record<ServiceId, ServiceInfo> = {
  erp: { name: 'ERP', icon: 'erp.png', description: 'Inventario, compras, ventas y finanzas coordinados en un mismo lugar.', title: 'Conecta tu operación', detail: 'Empieza vinculando las fuentes con las que trabaja tu empresa.' },
  producto: { name: 'Producto', icon: 'catalogo.png', description: 'Crea, importa y prepara tus fichas de producto para cada canal.' },
  analitica: { name: 'Analítica', icon: 'analitica.png', description: 'Consulta el rendimiento de tus productos, canales y operaciones.', title: 'Reúne tus datos', detail: 'Conecta tus canales para ver sus resultados en una misma vista.' },
  auditoria: { name: 'Captura y auditoría', icon: 'auditoria.png', description: 'Reúne información de origen y revisa la calidad de cada ficha.', title: 'Revisa tus productos', detail: 'Selecciona productos del catálogo para detectar vacíos y contrastar fuentes.' },
  agentes: { name: 'Agentes', icon: 'hive.png', description: 'Coordina tareas con acceso controlado a los servicios de Uonify.', title: 'Organiza tus agentes', detail: 'Define sus herramientas, permisos y acciones que requieren aprobación.' },
  academy: { name: 'Academy', icon: 'academy.png', description: 'Conocimiento y formación para los equipos que operan en Uonify.', title: 'Construye el aprendizaje de tu equipo', detail: 'Organiza recursos y recorridos por proyecto o función.' },
  logistica: { name: 'Logística', icon: 'logistica.png', description: 'Coordina preparación, envíos y seguimiento.', title: 'Conecta tus operaciones logísticas', detail: 'Reúne tus flujos de entrega y consulta su estado en un solo lugar.' },
  fabrica: { name: 'Fábrica y proveedores', icon: 'fabrica.png', description: 'Trabaja con proveedores y datos de fabricación.', title: 'Organiza tu red de proveedores', detail: 'Centraliza la información que necesitas para colaborar con ellos.' },
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

const ACTIVE_CATALOG: CatalogServiceId[] = ['producto', 'estudio', 'erp', 'nexus'];
const SOON_CATALOG: CatalogServiceId[] = ['analitica', 'auditoria', 'agentes', 'academy', 'logistica', 'fabrica'];

/**
 * Fuente única de los servicios que muestran el lanzador del espacio (ServicesMenu)
 * y el panel de la Home (ToolsPanel), con su estado. Orden y estados fijados por el
 * dueño (09-11-2026): activos Producto, Estudio, ERP y Nexus; el resto, «Próximamente».
 * Nombre e icono salen de SERVICES; Estudio es un acceso directo al chat, con icono
 * propio y sin vista de módulo.
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
