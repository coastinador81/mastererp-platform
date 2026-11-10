import { api, ApiError } from '@/shared/api/client';
import type { FinanceCollection, Page, Space } from './finance';
import { MastererpError } from './errors';

/** Origen de la pantalla de acceso de MasterERP (Hosted UI de Cognito de DEV): la ventana solo se abre ahí. */
export const MASTERERP_LOGIN_ORIGIN = 'https://mastererp-dev-uonify-277352717693.auth.us-west-1.amazoncognito.com';

/**
 * La cuenta del ERP la custodia el servidor de Uonify, como Drive (Consultor Google, C4): la
 * web nunca ve tokens de MasterERP ni ids internos. En la vista local responde la simulación
 * del módulo (mocks/handlers.ts), por las mismas rutas. Estado y elección de espacio y empresa en
 * /api/connections/erp; lecturas de las pantallas en /api/erp/<tipo>[/<referencia>], con
 * referencias opacas que el servidor resuelve.
 */
export interface LiveStatus {
  status: 'connected' | 'disconnected' | 'reauthorize' | 'not_linked' | 'account_mismatch';
  email?: string | null;
  spaces?: Space[];
  tenantId?: string | null;
  companies?: Space[];
  companyId?: string | null;
  modules?: string[];
  permissions?: string[];
  /** Solo en la web: falta una prueba o suscripción vigente. */
  subscriptionRequired?: boolean;
}

/** Tipo de documento del servidor por colección de la API del equipo. */
const KINDS: Record<FinanceCollection, string> = {
  'compras/solicitudes': 'compras',
  'compras/ordenes': 'ordenes',
  'compras/facturas': 'facturas',
  proveedores: 'proveedores',
  clientes: 'clientes',
  ventas: 'ventas',
};

const codeOf = (data: unknown): string => {
  if (typeof data !== 'object' || data === null) return 'erp_unavailable';
  const value = (data as { error?: unknown; detail?: { error?: unknown } }).error ?? (data as { detail?: { error?: unknown } }).detail?.error;
  return typeof value === 'string' ? value : 'erp_unavailable';
};

/** Los errores del servidor llegan como los del equipo (código HTTP), para sus mismos textos. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw new MastererpError(error.status, codeOf(error.data));
    throw error;
  }
}

/** Respuesta del servidor, con la forma de la de Drive: el estado va dentro de `connection`. */
interface StatusBody {
  connection?: LiveStatus;
  /** Sin prueba ni suscripción vigentes no se conecta ninguna herramienta (como Drive). */
  accessAllowed?: boolean;
}

const SUBSCRIPTION: LiveStatus = { status: 'disconnected', subscriptionRequired: true };
const unwrap = (body: StatusBody): LiveStatus => (body.accessAllowed === false ? SUBSCRIPTION : body.connection ?? { status: 'disconnected' });

export const liveStatus = async (signal?: AbortSignal) => unwrap(await guarded(() => api.get<StatusBody>('/connections/erp', { signal })));

export const liveSelect = async (tenantId: string, companyId?: string) =>
  unwrap(await guarded(() => api.post<StatusBody>('/connections/erp/selection', companyId ? { tenantId, companyId } : { tenantId })));

export const liveDisconnect = () => guarded(() => api.delete<unknown>('/connections/erp'));

/**
 * Acceso a MasterERP en esta misma pestaña, sin ventana emergente: el servidor prepara el intento
 * ligado a la sesión y, al terminar, vuelve a /espacio?service=erp&erp=<resultado>. Solo se sale
 * hacia la pantalla de acceso de MasterERP; cualquier otro destino se rechaza.
 */
export async function liveStart(): Promise<string> {
  const body = await guarded(() => api.post<{ authUrl?: unknown }>('/connections/erp/start', { popup: false }));
  const url = URL.canParse(String(body.authUrl)) ? new URL(String(body.authUrl)) : null;
  if (!url || url.origin !== MASTERERP_LOGIN_ORIGIN || url.username || url.password) throw new MastererpError(503, 'erp_unavailable');
  return url.href;
}

export async function liveList<T>(collection: FinanceCollection, options: { after?: string; limit?: number; q?: string; signal?: AbortSignal } = {}): Promise<Page<T>> {
  const body = await guarded(() => api.get<{ items?: T[]; nextCursor?: string | null }>(`/erp/${KINDS[collection]}`, {
    signal: options.signal,
    params: { after: options.after || undefined, limit: options.limit ?? 10, q: collection === 'ventas' && options.q ? options.q.slice(0, 120) : undefined },
  }));
  return { items: Array.isArray(body.items) ? body.items : [], nextCursor: body.nextCursor ?? null };
}

export async function liveRecord<T>(collection: FinanceCollection, reference: string, signal?: AbortSignal): Promise<T> {
  const body = await guarded(() => api.get<{ record?: T }>(`/erp/${KINDS[collection]}/${encodeURIComponent(reference)}`, { signal }));
  if (!body.record) throw new MastererpError(503, 'erp_unavailable');
  return body.record;
}
