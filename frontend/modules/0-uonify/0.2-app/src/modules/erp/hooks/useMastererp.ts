import { create } from 'zustand';
import type { Space, SpaceContext } from '../api/finance';
import { MastererpError } from '../api/errors';
import { liveDisconnect, liveSelect, liveStatus, type LiveStatus } from '../api/live';

export type MastererpStatus = 'idle' | 'checking' | 'disconnected' | 'connected' | 'no-access' | 'error';

interface MastererpState {
  status: MastererpStatus;
  /** Texto para la persona (literales de la app de Finanzas del equipo). */
  message: string | null;
  spaces: Space[];
  tenant: string;
  context: SpaceContext | null;
  company: string;
  check: () => Promise<void>;
  selectTenant: (tenant: string) => Promise<void>;
  selectCompany: (company: string) => void;
  disconnect: () => void;
}

const MODULE = 'erp.finance';
const READ_PERMISSIONS = ['administration.parties.read', 'administration.purchases.read', 'administration.read'];

type Patch = Partial<Pick<MastererpState, 'status' | 'message' | 'spaces' | 'tenant' | 'context' | 'company'>>;

const EMPTY = { spaces: [], tenant: '', context: null, company: '' };

/**
 * Estado que devuelve el servidor de Uonify (custodia la cuenta del ERP, como Drive), con los
 * textos de session.jsx y Finance.jsx del equipo para cada caso.
 */
function fromLive(live: LiveStatus): Patch {
  if (live.subscriptionRequired) return { ...EMPTY, status: 'no-access', message: 'Necesitas una prueba o suscripción vigente para conectar tus herramientas.' };
  if (live.status === 'not_linked') return { ...EMPTY, status: 'no-access', message: 'Tu identidad todavía no tiene acceso asignado en MasterERP.' };
  if (live.status === 'reauthorize') return { ...EMPTY, status: 'disconnected', message: 'Tu sesión ha finalizado. Vuelve a acceder.' };
  if (live.status === 'account_mismatch') return { ...EMPTY, status: 'error', message: 'La cuenta de MasterERP no coincide con la que conectaste. Desconecta para cambiar de cuenta.' };
  if (live.status !== 'connected') return { ...EMPTY, status: 'disconnected', message: null };
  const spaces = (live.spaces ?? []).filter(space => typeof space?.id === 'string' && typeof space?.name === 'string');
  const tenant = live.tenantId ?? '';
  if (!spaces.length) return { ...EMPTY, status: 'no-access', message: 'Todavía no tienes un espacio asignado.' };
  if (!tenant) return { ...EMPTY, spaces, status: 'connected', message: 'Selecciona un espacio para continuar.' };
  const companies = (live.companies ?? []).filter(company => typeof company?.id === 'string' && typeof company?.name === 'string');
  // Si el servidor no trae los permisos, el menú no los adivina: deja abrir y la API decide (403 → «Acceso denegado.»).
  const context: SpaceContext = { tenant_id: tenant, modules: live.modules ?? [MODULE], permissions: live.permissions ?? READ_PERMISSIONS, companies };
  if (live.modules && !live.modules.includes(MODULE)) return { spaces, tenant, context, company: '', status: 'no-access', message: 'No tienes acceso a Finanzas en este espacio.' };
  if (!companies.length) return { spaces, tenant, context, company: '', status: 'no-access', message: 'No hay empresas activas autorizadas para este módulo.' };
  const company = live.companyId ?? '';
  return { spaces, tenant, context, company, status: 'connected', message: company ? null : 'Selecciona una empresa para trabajar con Finanzas.' };
}

const failure = (error: unknown): Patch =>
  error instanceof MastererpError && error.status === 401
    ? { status: 'error', message: 'Tu sesión de Uonify ha cambiado. Vuelve a entrar.' }
    : { status: 'error', message: 'No se pudo validar el acceso. Vuelve a intentarlo.' };

/**
 * Conexión con la cuenta del ERP para ERP · Finanzas: estado, espacio (inquilino) y empresa,
 * siempre a través del servidor de Uonify. Ningún token del ERP llega a la web. El contexto
 * solo enseña u oculta: el ERP vuelve a autorizar cada lectura.
 */
export const useMastererp = create<MastererpState>((set, get) => ({
  status: 'idle',
  message: null,
  ...EMPTY,
  check: async () => {
    set({ status: 'checking', message: 'Validando espacio y permisos…' });
    try {
      set(fromLive(await liveStatus()));
    } catch (error) {
      set(failure(error));
    }
  },
  selectTenant: async tenant => {
    set({ status: 'checking', message: 'Validando espacio y permisos…', tenant, context: null, company: '' });
    try {
      set(fromLive(await liveSelect(tenant)));
    } catch (error) {
      set(failure(error));
    }
  },
  selectCompany: company => {
    const { tenant, context } = get();
    if (!context?.companies.some(item => item.id === company)) return;
    void liveSelect(tenant, company).then(live => set(fromLive(live)), error => set(failure(error)));
  },
  disconnect: () => {
    // El servidor revoca en Cognito y borra la conexión; aquí solo se olvida el estado.
    void liveDisconnect().catch(() => undefined);
    set({ status: 'disconnected', message: null, ...EMPTY });
  },
}));

/** Lista para pedir datos reales: conectado, con espacio y empresa. */
export const readyScope = (state: Pick<MastererpState, 'status' | 'tenant' | 'company'>): { tenant: string; company: string } | null =>
  state.status === 'connected' && state.tenant && state.company ? { tenant: state.tenant, company: state.company } : null;
