/**
 * Módulo catalog: servicio Producto del espacio de trabajo (catálogo, ficha, pestañas
 * pim-*, «Publicar» y el producto de ejemplo). Puerta única para los demás módulos.
 * Sus rutas (/espacio/producto…) se declaran en routes.tsx y se registran solas.
 *
 *   productPath({ sku, tab })   ruta de una ficha (/espacio/producto/UON-KIT-01/gpsr)
 *   useProducts()               catálogo (GET /products) con TanStack Query
 *   useCatalogProduct(sku)      un producto del catálogo en caché
 */
import { registerAmazonChannel } from './api/amazonChannel';

// El canal «Amazon» del diálogo «Publicar» (los marketplaces nuevos se registran igual).
registerAmazonChannel();

export { productPath, parseProductRoute, PRODUCT_BASE_PATH, NEW_PRODUCT_SEGMENT, DEFAULT_TAB } from './model/paths';
// Reglas del panel lateral, foco y entrada de la ficha, para que otros servicios con mesa (ERP · Finanzas) se comporten igual.
export { WIDE_SCREEN_QUERY, applyDrawer, defaultLayout, isNarrowWidth, layoutForView, layoutOnNarrow, toggleFromHeader, toggleFromRail, type DrawerState } from './model/layout';
export { hasEditingFocus } from './hooks/focus';
export { useSheetEnter } from './hooks/usePlayEnter';
export { useProducts, catalogKeys } from './api/queries';
export { useCatalogProduct } from './hooks/useCatalogProduct';
export { AMAZON_CHANNEL } from './api/amazonChannel';
export type { CatalogProduct, ProductRoute, SampleDefinition } from './model/types';

export { GuideCard } from './guide/GuideCard';
export { handleGuideText, pauseGuide } from './guide/actions';
export { startsGuide } from './guide/model';
export { guideOf } from './guide/store';

export { ProductDemoPreview } from './guide/ProductDemoPreview';
export { getProductPreparation, updateProductPreparation, preparationKey } from './api/preparation';
export type { ProductPreparation, PreparationUpdate, PreparationSection, PreparationField } from './api/preparation';
export { getAmazonRequirements, amazonRequirementsKey } from './api/amazonRequirements';
export type { AmazonReasoning, AmazonRequirements } from './api/amazonRequirements';
export { AmazonReasoningStatus } from './components/AmazonReasoningStatus';
