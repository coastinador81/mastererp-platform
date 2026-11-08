import { create } from 'zustand';
import type { DrawerState } from '../model/layout';
import { EMPTY_FILTERS, type CatalogFilters } from '../model/catalogRules';
import type { ChannelStates, PublishRequest } from '../model/types';

/**
 * Estado de interfaz del servicio Producto que comparten componentes lejanos
 * (prototipo: state.productCatalogOpen/Pinned, publishSelection,
 * channelStatesByProduct y channelMenuFor de app-shell.js).
 * - El catálogo lateral y la selección duran mientras la app está abierta.
 * - Los canales activos por producto se guardan en la sesión (como el prototipo).
 */
const CHANNELS_KEY = 'uonify-catalog-channels-v1';

function readChannels(): Record<string, ChannelStates> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(CHANNELS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, ChannelStates>) : {};
  } catch {
    return {};
  }
}

function writeChannels(value: Record<string, ChannelStates>): void {
  try {
    sessionStorage.setItem(CHANNELS_KEY, JSON.stringify(value));
  } catch {
    /* Sin almacenamiento la pantalla sigue funcionando. */
  }
}

export interface CatalogStore {
  drawer: DrawerState;
  /** Ya se aplicó la disposición inicial (una vez por carga de la app). */
  layoutReady: boolean;
  /** SKUs marcados en el catálogo para publicarlos juntos. */
  selection: string[];
  channelStates: Record<string, ChannelStates>;
  /** Canal cuyo menú está abierto en la cabecera. */
  channelMenuFor: string | null;
  filters: CatalogFilters;
  publishRequest: PublishRequest | null;
  /**
   * Ficha guardada con otro SKU (o recién creada) mientras la URL aún no ha cambiado:
   * la vista `from` («new» o «sku:…») ya muestra el producto `sku`.
   */
  redirect: { from: string; sku: string } | null;
  setDrawer: (next: DrawerState) => void;
  markLayoutReady: () => void;
  setSelected: (sku: string, on: boolean) => void;
  setSelection: (skus: string[]) => void;
  /** Un SKU renombrado conserva su selección y sus canales. */
  renameSku: (from: string, to: string) => void;
  /** Un producto eliminado deja de estar seleccionado y pierde sus canales. */
  forgetSku: (sku: string) => void;
  setChannel: (sku: string, channel: string, on: boolean) => void;
  setChannelMenu: (name: string | null) => void;
  setFilters: (patch: Partial<CatalogFilters>) => void;
  openPublishDialog: (request: PublishRequest) => void;
  closePublishDialog: () => void;
  setRedirect: (redirect: { from: string; sku: string } | null) => void;
}

export const useCatalogStore = create<CatalogStore>((set, get) => ({
  drawer: { open: false, pinned: false },
  layoutReady: false,
  selection: [],
  channelStates: readChannels(),
  channelMenuFor: null,
  filters: EMPTY_FILTERS,
  publishRequest: null,
  redirect: null,
  setDrawer: drawer => {
    const current = get().drawer;
    if (current.open !== drawer.open || current.pinned !== drawer.pinned) set({ drawer });
  },
  markLayoutReady: () => set({ layoutReady: true }),
  setSelected: (sku, on) => set(state => ({
    selection: on ? (state.selection.includes(sku) ? state.selection : [...state.selection, sku]) : state.selection.filter(item => item !== sku),
  })),
  setSelection: skus => set({ selection: [...new Set(skus)] }),
  renameSku: (from, to) => set(state => {
    const selection = state.selection.includes(from) ? [...new Set(state.selection.map(item => (item === from ? to : item)))] : state.selection;
    if (!state.channelStates[from]) return { selection };
    const { [from]: moved, ...rest } = state.channelStates;
    const channelStates = { ...rest, [to]: moved };
    writeChannels(channelStates);
    return { selection, channelStates };
  }),
  forgetSku: sku => set(state => {
    const selection = state.selection.filter(item => item !== sku);
    if (!state.channelStates[sku]) return { selection };
    const { [sku]: _dropped, ...channelStates } = state.channelStates;
    writeChannels(channelStates);
    return { selection, channelStates };
  }),
  setChannel: (sku, channel, on) => set(state => {
    const channelStates = { ...state.channelStates, [sku]: { ...(state.channelStates[sku] || {}), [channel]: on } };
    writeChannels(channelStates);
    return { channelStates };
  }),
  setChannelMenu: channelMenuFor => set({ channelMenuFor }),
  setFilters: patch => set(state => ({ filters: { ...state.filters, ...patch } })),
  openPublishDialog: publishRequest => set({ publishRequest }),
  closePublishDialog: () => set({ publishRequest: null }),
  setRedirect: redirect => set({ redirect }),
}));

/** Canales de un producto como los lee la cabecera (solo `true` cuenta como activo). */
export function channelStatesOf(states: Record<string, ChannelStates>, sku: string | null, channels: string[]): ChannelStates {
  const saved = sku ? states[sku] : undefined;
  return Object.fromEntries(channels.map(name => [name, saved?.[name] === true]));
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useCatalogStore.setState({ drawer: { open: false, pinned: false }, layoutReady: false, selection: [],
    channelStates: {}, channelMenuFor: null, filters: EMPTY_FILTERS, publishRequest: null, redirect: null });
  writeChannels({});
});
