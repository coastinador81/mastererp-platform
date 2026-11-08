import { currentAccountEmail } from '@/modules/auth';
import { BlenderProductWorkspace } from '@/modules/blender';
import { useTabContext } from '@/shared/pim';

export function LiveModelos3DTab() {
  const context = useTabContext();
  const account = currentAccountEmail() ?? '';
  const productId = typeof context.product?.id === 'string' ? context.product.id : null;
  const productLabel = context.product ? `${context.product.name} · SKU: ${context.product.sku}` : 'Nuevo producto';
  return <div className="pim-tab pim-modelos3d-root">
    <header className="pim-head pim-modelos3d-live-head"><div className="pim-modelos3d-headrow"><h2>Modelos 3D</h2><span className="pim-badge">Blender local</span></div><p className="pim-modelos3d-product-label" title={productLabel}>{productLabel}</p></header>
    {!context.isNew && productId ? <BlenderProductWorkspace key={`${account}:${productId}`} account={account} productId={productId} /> : <section className="pim-card pim-card-dashed pim-modelos3d-empty"><h3>Guarda el producto para empezar</h3><p className="pim-modelos3d-text">La escena y las vistas previas de Blender se guardarán en la ficha de este producto.</p><button type="button" className="pim-btn pim-btn-outline" onClick={() => context.switchTab('atributos')}>Ir a atributos</button></section>}
  </div>;
}
