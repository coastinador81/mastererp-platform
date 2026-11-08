/**
 * Infraestructura común de la ficha de producto (src/shared/pim). Puerta única:
 * importa siempre desde «@/shared/pim». Detalles y ejemplos: README.md.
 * Origen: pim/core.js (almacén, rutas, utilidades), app-shell.js (pimContext,
 * PIM_TABS), pim/publicar.js y pim/atributos.js (canales y publicadores).
 */
import { clamp, debounce, download, escapeHTML, formatBytes, readFileAsDataURL, readFileAsText, sleep, uid } from '@/shared/lib';

// Almacén por producto
export {
  pimStore,
  createPimStore,
  PIM_STORE_KEY,
  NEW_PRODUCT_KEY,
  type PimStore,
  type PimScope,
  type PimEntry,
  type PimStoreEvent,
  type PimStoreOptions,
} from './store/pimStore';
export { usePimStore, usePimValue, usePimSlice, usePimScope, type PimStoreView, type SliceSetter } from './store/usePimStore';

// Pestañas y su contexto
export {
  PIM_TAB_ORDER,
  PIM_TABS,
  PIM_TAB_LABELS,
  isPimTabKey,
  sortPimTabs,
  type PimTabKey,
  type PimTabDefinition,
} from './tabs';
export type { PimTabContext, PimProduct, PimEdited, PersistOptions } from './context/types';
export {
  PimTabReactContext,
  PimTabProvider,
  PimTabHost,
  useTabContext,
  useOptionalTabContext,
  type PimTabHostProps,
} from './context/PimTabProvider';

// Canales, publicadores y campos personalizados
export {
  registerChannel,
  getChannels,
  getChannel,
  registerPublisher,
  getPublisher,
  publishWith,
  subscribeChannels,
  useChannels,
  type Channel,
  type ChannelDefinition,
  type Publisher,
  type PublishData,
  type PublishCheck,
  type PublishResult,
  type PublishIssue,
} from './registry/channels';
export { registerDefaultCustomFields, getDefaultCustomFields, type DefaultCustomFields } from './registry/customFields';

// Rutas de los servicios (bajo API_BASE)
export { PIM_ENDPOINTS, PIM_REQUEST_TIMEOUT, MARKETPLACE, type PimEndpoint } from './endpoints';

// Utilidades del núcleo (también en @/shared/lib)
export { clamp, debounce, download, escapeHTML, formatBytes, readFileAsDataURL, readFileAsText, sleep, uid };
/** `util` del prototipo (UonifyPIM.util), para puertos que lo usaban así. */
export const util = { clamp, debounce, download, escapeHTML, formatBytes, readFileAsDataURL, readFileAsText, sleep, uid } as const;

export { setActiveProduct, activeProductContext, hasProductEdits, notifyProductChanges, askProductAssistant, type ProductChange } from './liveProduct';
