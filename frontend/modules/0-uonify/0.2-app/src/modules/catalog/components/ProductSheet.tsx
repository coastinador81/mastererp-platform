import { USE_MOCKS } from '@/shared/api/config';
import { LiveProductVersion } from './LiveProductVersion';
import { LiveProductSave } from './LiveProductSave';
import { PimTabHost, type PimTabContext, type PimTabDefinition, type PimTabKey } from '@/shared/pim';
import type { CatalogProduct } from '../model/types';
import { ProductHeader } from './ProductHeader';
import { ProductTabs } from './ProductTabs';
import { TabBoundary } from './TabBoundary';
import { ProductPreparationPanel } from './ProductPreparationPanel';
import { IncidentsView, useIncidents } from '@/modules/product-incidents';
import { AmazonRequirementsPanel } from './AmazonRequirementsPanel';
import { ProductMaterialsPanel } from './ProductMaterialsPanel';

export interface ProductSheetProps {
  product: CatalogProduct | null;
  context: PimTabContext;
  definitions: PimTabDefinition[];
  tab: PimTabKey;
  /** Sembrado el ejemplo y los campos iniciales: ya se puede montar la pestaña. */
  ready: boolean;
  onSelectTab: (tab: PimTabKey, focus: boolean) => void;
  onDelete: () => void;
  onClose: (detail: number) => void;
  onPublish: () => void;
  onViewIncidents?: () => void;
}

/**
 * Ficha de producto (prototipo: el editor de renderProductWorkspace): cabecera,
 * pestañas y la pestaña activa montada con su contexto en #product-pim-host.
 * Otra pestaña u otro producto la montan de nuevo; lo demás la conserva.
 */
export function ProductSheet({ product, context, definitions, tab, ready, onSelectTab, onDelete, onClose, onPublish, onViewIncidents }: ProductSheetProps) {
  const definition = definitions.find(item => item.key === tab);
  const { query: incidents } = useIncidents({ sku: product?.sku, status: 'active' }, !!product && !USE_MOCKS);
  const incidentCount = incidents.data?.summary.active ?? 0;
  const hasEditor = tab !== 'incidencias' && (USE_MOCKS || !product || ['atributos','descripciones','modelos3d','gpsr'].includes(tab));
  return (
    <div className="product-editor-layout">
      <ProductHeader product={product} pimKey={context.key} onDelete={onDelete} onClose={onClose} onPublish={onPublish} incidentCount={incidentCount} onOpenIncidents={() => onSelectTab('incidencias', true)} />
      {!USE_MOCKS && product && <LiveProductVersion product={product} />}
      <ProductTabs definitions={definitions} active={tab} onSelect={onSelectTab} incidentCount={incidentCount} />
      <div className="product-editor-surface" id="product-tab-panel" role="tabpanel" aria-labelledby={`product-tab-${tab}`} tabIndex={0}>
        {!USE_MOCKS && product && tab === 'atributos' && <ProductMaterialsPanel product={product} />}
        {!USE_MOCKS && product && tab === 'atributos' && <AmazonRequirementsPanel product={product} />}
        {hasEditor && (ready && definition ? (
          <TabBoundary key={`${context.key}:${tab}`}>
            <PimTabHost tab={definition} context={context} id="product-pim-host" data-pim-key={context.key} data-pim-tab={tab} />
          </TabBoundary>
        ) : (
          <div id="product-pim-host" data-pim-key={context.key} data-pim-tab={tab}>
            <p className="product-pim-loading">Cargando…</p>
          </div>
        ))}
        {tab === 'incidencias' && product && <IncidentsView sku={product.sku} onViewAll={onViewIncidents} />}
        {!USE_MOCKS && product && tab !== 'incidencias' && tab !== 'gpsr' && <ProductPreparationPanel product={product} tab={tab} onSelectTab={onSelectTab} complementary={hasEditor} />}
      </div>
      {!USE_MOCKS && tab === 'descripciones' && product && <LiveProductSave context={context} />}
    </div>
  );
}
