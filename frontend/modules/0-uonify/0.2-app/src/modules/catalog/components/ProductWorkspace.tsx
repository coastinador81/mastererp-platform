import { currentAccountEmail } from '@/modules/auth';
import { USE_MOCKS } from '@/shared/api/config';
import { useLiveProduct } from '../hooks/useLiveProduct';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { IncidentsView } from '@/modules/product-incidents';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useLatest } from '@/shared/hooks';
import { dialog, toast } from '@/shared/ui';
import { isPimTabKey, pimStore, type PimTabKey } from '@/shared/pim';
import { ConversationDock, TopbarCenter, useWorkspaceUi } from '@/modules/workspace';
import { registerAmazonChannel } from '../api/amazonChannel';
import { deleteProduct } from '../api/products';
import { getCachedProducts, setCachedProducts, useProducts } from '../api/queries';
import { DEFAULT_TAB, sheetKey } from '../model/paths';
import type { CatalogProduct } from '../model/types';
import { PIM_TAB_DEFINITIONS } from '../tabs';
import { cssEscape, focusAfterClosingSheet, focusWhenReady } from '../hooks/focus';
import { useCatalogDrawer } from '../hooks/useCatalogDrawer';
import { useCatalogKeyboard } from '../hooks/useCatalogKeyboard';
import { useCatalogStore } from '../hooks/useCatalogStore';
import { useSheetEnter } from '../hooks/usePlayEnter';
import { usePersistProduct } from '../hooks/usePersistProduct';
import { useProductContext, useSheetPreparation } from '../hooks/useProductContext';
import { useProductNavigation, useProductRoute } from '../hooks/useProductRoute';
import { usePublishActions } from '../hooks/usePublishActions';
import { CatalogSidebar } from './CatalogSidebar';
import { ChannelBar } from './ChannelBar';
import { ProductSheet } from './ProductSheet';
import { PublishDialog } from './publish/PublishDialog';
import '../styles/index.css';

registerAmazonChannel();

const focusTab = (tab: PimTabKey) => focusWhenReady(() => document.querySelector(`[data-product-tab="${cssEscape(tab)}"]`));

// Cierra el catálogo sin fijar al abrir una ficha desde él (como el prototipo).
function foldUnpinned(): void {
  const { drawer, setDrawer } = useCatalogStore.getState();
  if (!drawer.pinned) setDrawer({ open: false, pinned: false });
}

/**
 * Servicio Producto en el espacio de trabajo (prototipo: renderProductWorkspace y sus
 * manejadores de app-shell.js): catálogo a la izquierda y, en el centro, la ficha del
 * producto elegido o nuevo, o la conversación centrada si no hay ficha. Los canales
 * de venta van en el centro de la cabecera.
 */
export function ProductWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const showingIncidents = location.pathname.replace(/\/+$/, '') === '/espacio/producto/incidencias/todas';
  const openIncidents = () => { foldUnpinned(); navigate('/espacio/producto/incidencias/todas'); };
  const route = useProductRoute();
  const routeRef = useLatest(route);
  const { closeSheet, openProduct, openNew, switchTab } = useProductNavigation(route);
  const ui = useWorkspaceUi();
  const client = useQueryClient();
  const productsQuery = useProducts();
  const products = productsQuery.data;
  const list: CatalogProduct[] = products ?? [];
  const loading = productsQuery.isPending;
  const product = route.sku ? list.find(item => item.sku === route.sku) ?? null : null;
  useLiveProduct(product);
  const waiting = loading && Boolean(route.sku);
  const hasSheet = showingIncidents || route.isNew || Boolean(product) || waiting;
  const sheet = showingIncidents ? 'incidents' : hasSheet ? sheetKey(route) : 'none';

  const center = useRef<HTMLElement>(null);
  const { workbenchRef, toggleRef, railMainRef, drawer, narrow, setOpen, onRailClick, onToggleClick, collapseUnpinned } = useCatalogDrawer(sheet, hasSheet);
  useCatalogKeyboard(setOpen);
  useSheetEnter(center, sheet, route.tab);
  // Uony sabe en qué ficha está la persona («Sigo contigo en la ficha de «…»»).
  const { setSheetTitle } = ui;
  const sheetTitle = hasSheet ? product?.name ?? null : null;
  useEffect(() => {
    setSheetTitle(sheetTitle);
  }, [setSheetTitle, sheetTitle]);
  useEffect(() => () => setSheetTitle(null), [setSheetTitle]);

  const request = useCatalogStore(state => state.publishRequest);
  const closePublishDialog = useCatalogStore(state => state.closePublishDialog);
  const setChannel = useCatalogStore(state => state.setChannel);
  const openPublish = usePublishActions();
  const persist = usePersistProduct(routeRef);
  const pendingDrop = useRef<string | null>(null);

  // Una ficha que ya no está en el catálogo (eliminada, o una URL antigua) vuelve al catálogo.
  useEffect(() => {
    if (!showingIncidents && productsQuery.isSuccess && route.sku && !product) closeSheet();
  }, [showingIncidents, productsQuery.isSuccess, route.sku, product, closeSheet]);

  // La pestaña abierta guarda lo pendiente al desmontarse: el estado del producto
  // eliminado se vacía después, para que nada vuelva.
  useEffect(() => {
    const sku = pendingDrop.current;
    if (!sku || (products ?? []).some(item => item.sku === sku)) return;
    pendingDrop.current = null;
    pimStore.drop(sku);
  }, [products]);

  const selectTab = useCallback((tab: PimTabKey, focus = true) => {
    if (!isPimTabKey(tab)) return;
    switchTab(tab);
    if (focus) focusTab(tab);
  }, [switchTab]);
  const context = useProductContext({ product, persist, switchTab: selectTab });
  const ready = useSheetPreparation(product, hasSheet && !waiting);

  const onOpenProduct = (sku: string) => {
    foldUnpinned();
    openProduct(sku);
    focusWhenReady(() => center.current);
  };

  const onCreate = () => {
    foldUnpinned();
    openNew();
  };

  const onDelete = async () => {
    if (!product) return;
    const confirmed = await dialog.confirm({
      title: `¿Eliminar el producto «${product.name}» de este catálogo?`,
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!confirmed) return;
    const account = currentAccountEmail();
    const sku = product.sku;
    try { await deleteProduct(sku); } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo eliminar'); return; }
    if (!USE_MOCKS && currentAccountEmail() !== account) return;
    pendingDrop.current = sku;
    setCachedProducts(client, items => items.filter(item => item.sku !== sku));
    useCatalogStore.getState().forgetSku(sku);
    closeSheet();
    focusAfterClosingSheet(1, () => center.current, ui.focusComposer);

  };

  const onPublishOpen = () => {
    if (!product) {
      ui.announce('Guarda el producto para publicarlo.');
      return;
    }
    void openPublish([product]);
  };

  const renderCenter = () => {
    if (showingIncidents) return <IncidentsView onClose={closeSheet} />;
    if (waiting) {
      return (
        <div className="product-editor-layout">
          <p className="product-pim-loading" role="status">Cargando…</p>
        </div>
      );
    }
    if (!hasSheet) {
      return (
        <div className="product-chat-anchor" id="product-chat-anchor">
          <ConversationDock />
        </div>
      );
    }
    return (
      <ProductSheet
        product={product}
        context={context}
        definitions={PIM_TAB_DEFINITIONS}
        tab={route.tab}
        ready={ready}
        onSelectTab={selectTab}
        onDelete={() => void onDelete()}
        onClose={detail => {
          closeSheet();
          focusAfterClosingSheet(detail, () => center.current, ui.focusComposer);
        }}
        onPublish={onPublishOpen}
        onViewIncidents={openIncidents}
      />
    );
  };

  const collapseFromCenter = (target: EventTarget) => {
    if (!(target instanceof Element) || !target.closest('[data-product-drawer]')) collapseUnpinned();
  };

  return (
    <>
      <TopbarCenter>
        {USE_MOCKS ? <ChannelBar product={product} hasSheet={hasSheet} onConnect={channel => ui.selectService('nexus', channel.toLowerCase())} /> : <span className="live-product-channel">Amazon · publicación en preparación</span>}
      </TopbarCenter>
      <section
        ref={workbenchRef}
        className={clsx('product-workbench', drawer.open && 'is-catalog-open', drawer.open && drawer.pinned && 'is-catalog-pinned')}
        aria-label="Producto"
      >
        <CatalogSidebar
          products={list}
          status={products ? 'success' : productsQuery.isError ? 'error' : 'pending'}
          selectedSku={product?.sku ?? null}
          drawer={drawer}
          narrow={narrow}
          toggleRef={toggleRef}
          railMainRef={railMainRef}
          onRailClick={onRailClick}
          onToggleClick={onToggleClick}
          navOpen={ui.isNavigationOpen}
          onCreate={onCreate}
          onImport={() => USE_MOCKS ? ui.selectService('nexus') : toast.info('La importación de materiales se incorporará al flujo de creación. Puedes empezar desde cero con Uony.')}
          onOpenProduct={onOpenProduct}
          onPublish={selected => void openPublish(selected)}
          onRetry={() => void productsQuery.refetch()}
          onViewIncidents={openIncidents}
        />
        <section
          ref={center}
          className="product-center"
          tabIndex={-1}
          aria-label={hasSheet ? 'Ficha de producto' : undefined}
          onPointerDown={event => collapseFromCenter(event.target)}
          onFocus={event => collapseFromCenter(event.target)}
        >
          <fieldset className="live-product-fieldset" disabled={!USE_MOCKS && ui.isAssistantBusy}>{renderCenter()}</fieldset>
        </section>
      </section>
      {request ? (
        <PublishDialog
          request={request}
          onClose={closePublishDialog}
          onOpenProduct={(sku, tab) => {
            if (!getCachedProducts(client).some(item => item.sku === sku)) return;
            const target = isPimTabKey(tab) ? tab : DEFAULT_TAB;
            foldUnpinned();
            openProduct(sku, target);
            focusTab(target);
          }}
          onPublished={(sku, channel) => {
            if (getCachedProducts(client).some(item => item.sku === sku)) setChannel(sku, channel, true);
          }}
        />
      ) : null}
    </>
  );
}
