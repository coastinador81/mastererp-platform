import { useMemo } from 'react';
import { useMediaQuery } from '@/shared/hooks';
import { chatPanelVisible, NARROW_CHAT_QUERY } from '../model/chatPanel';
import type { ServiceId } from '../model/services';
import {
  closeNavDrawer,
  focusComposer,
  openNavDrawer,
  selectService,
  setChatPanel,
  startNewThread,
  toggleNavDrawer,
} from './actions';
import { announce, setUi, useUiStore } from './uiStore';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { useWorkspaceStore } from './workspaceStore';

/**
 * Lo que el espacio ofrece a los servicios que pinta (catalog y los que vengan):
 *
 *   const ui = useWorkspaceUi();
 *   ui.openConversation(); ui.closeConversation(); ui.isConversationOpen
 *   ui.openNavigation(botón); ui.isNavigationOpen          (panel «Hilos y proyectos»)
 *   ui.selectService('nexus', 'amazon')                     (también actualiza el hilo)
 *   ui.focusComposer()                                      (tras cerrar una ficha)
 *   ui.announce('Guarda el producto para publicarlo.')      (región viva de la conversación)
 *   ui.setSheetTitle(producto?.name ?? null)                (Uony: «Sigo contigo en la ficha de «…»»)
 */
export interface WorkspaceUi {
  isAssistantBusy?: boolean;
  isConversationOpen: boolean;
  openConversation(origin?: HTMLElement | null): void;
  closeConversation(origin?: HTMLElement | null): void;
  toggleConversation(origin?: HTMLElement | null): void;
  isNavigationOpen: boolean;
  openNavigation(trigger?: HTMLElement | null): void;
  closeNavigation(restoreFocus?: boolean): void;
  toggleNavigation(trigger?: HTMLElement | null): void;
  selectService(service: ServiceId, view?: string): void;
  startNewThread(): void;
  focusComposer(): void;
  announce(text: string): void;
  setSheetTitle(name: string | null): void;
}

export function useWorkspaceUi(): WorkspaceUi {
  const { service } = useWorkspaceRoute();
  const busy = useUiStore(state => Boolean(state.pendingReply));
  const centred = useUiStore(state => state.embeddedDocks > 0);
  const sheetOpen = useUiStore(state => state.chatSheetOpen);
  const navOpen = useUiStore(state => state.navOpen);
  const collapsed = useWorkspaceStore(state => state.chatPanelCollapsed);
  const narrow = useMediaQuery(NARROW_CHAT_QUERY);
  const open = chatPanelVisible({ service, centred, narrow, sheetOpen, collapsed });

  return useMemo<WorkspaceUi>(
    () => ({
      isAssistantBusy: busy,
      isConversationOpen: open,
      openConversation: origin => setChatPanel(true, origin ?? null),
      closeConversation: origin => setChatPanel(false, origin ?? null),
      toggleConversation: origin => setChatPanel(!open, origin ?? null),
      isNavigationOpen: navOpen,
      openNavigation: trigger => openNavDrawer(trigger),
      closeNavigation: restoreFocus => closeNavDrawer(restoreFocus),
      toggleNavigation: trigger => toggleNavDrawer(trigger),
      selectService: (id, view) => selectService(id, view),
      startNewThread: () => startNewThread(),
      focusComposer,
      announce,
      setSheetTitle: name => setUi({ sheetTitle: name }),
    }),
    [open, navOpen, busy],
  );
}
