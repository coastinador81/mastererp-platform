/**
 * Módulo workspace: el espacio de trabajo de Uonify (/espacio). Puerta única de
 * entrada para los demás módulos.
 *
 *   <TopbarCenter>       portal al centro de la cabecera (canales de Producto)
 *   <ConversationDock/>  conversación centrada dentro de la vista de un servicio
 *   useWorkspaceUi()     conversación, panel de hilos, servicios, foco y avisos
 */
export { TopbarCenter } from './components/TopbarCenter';
export { ConversationDock } from './components/ConversationPanel';
export { useWorkspaceUi, type WorkspaceUi } from './hooks/useWorkspaceUi';
export { playEnter, reduceMotion, type EnterVariant } from './model/motion';
export { prepareOnboardingEntry } from './model/onboardingEntry';
export {
  SERVICES,
  SERVICE_ORDER,
  SERVICE_CATALOG,
  servicePath,
  serviceIcon,
  parseWorkspacePath,
  PRODUCT_NEW_SEGMENT,
  WORKSPACE_PATH,
  type ServiceId,
  type ServiceInfo,
  type CatalogServiceId,
  type ServiceCatalogEntry,
  type WorkspaceRoute,
} from './model/services';

export { GoogleAiPicker } from './components/composer/GoogleAiPicker';
export { AccountMenu } from './components/AccountMenu';
export { Topbar } from './components/Topbar';
export { startIncidentResolution, startMaterialReview } from './hooks/liveConversation';
export type { ConversationField, FieldValidation } from './model/conversationForm';
export { formResponse } from './model/conversationForm';
