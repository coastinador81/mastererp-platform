import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { PimTabKey } from '@/shared/pim';
import { DEFAULT_TAB, parseProductRoute, productPath, sheetKey } from '../model/paths';
import type { ProductRoute } from '../model/types';
import { useCatalogStore } from './useCatalogStore';

/**
 * Vista del servicio Producto según la URL (/espacio/producto[/:sku[/:tab]]). Tras
 * guardar con otro SKU (o crear), la vista ya muestra el producto guardado mientras
 * la URL se actualiza.
 */
export function useProductRoute(): ProductRoute {
  const { sku, tab } = useParams();
  const raw = useMemo(() => parseProductRoute({ sku, tab }), [sku, tab]);
  const redirect = useCatalogStore(state => state.redirect);
  const setRedirect = useCatalogStore(state => state.setRedirect);
  const applies = Boolean(redirect) && redirect?.from === sheetKey(raw);
  useEffect(() => {
    if (redirect && !applies) setRedirect(null);
  }, [redirect, applies, setRedirect]);
  return useMemo(() => (applies && redirect ? { sku: redirect.sku, isNew: false, tab: raw.tab } : raw), [applies, redirect, raw]);
}

/**
 * Navegación del servicio Producto (en el prototipo cambiaban state.selectedProductSku,
 * serviceView y productTab). Elegir otro producto conserva la pestaña abierta.
 */
export function useProductNavigation(route: ProductRoute) {
  const navigate = useNavigate();
  const openProduct = useCallback((sku: string, tab: PimTabKey = route.tab) => {
    navigate(productPath({ sku, tab }));
  }, [navigate, route.tab]);
  const openNew = useCallback(() => navigate(productPath({ isNew: true, tab: DEFAULT_TAB })), [navigate]);
  const closeSheet = useCallback(() => navigate(productPath()), [navigate]);
  const switchTab = useCallback((tab: PimTabKey) => {
    if (!route.sku && !route.isNew) return;
    navigate(productPath({ sku: route.sku, isNew: route.isNew, tab }));
  }, [navigate, route.sku, route.isNew]);
  return { openProduct, openNew, closeSheet, switchTab };
}

export type ProductNavigation = ReturnType<typeof useProductNavigation>;
