import { currentAccountEmail } from '@/modules/auth';
import { ProductDriveAnalysis } from '@/modules/drive';
import { startMaterialReview } from '@/modules/workspace';
import type { CatalogProduct } from '../model/types';
import { useState } from 'react';

export function ProductMaterialsPanel({ product }: { product: CatalogProduct }) {
  const account = currentAccountEmail();
  const [open, setOpen] = useState(false);
  return account ? <details className="product-drive-materials" onToggle={event => setOpen(event.currentTarget.open)}><summary>Materiales y fuentes del producto · Google Drive</summary>
    {open && <ProductDriveAnalysis account={account} sku={product.sku} revision={Number(product.revision)} onReview={id => startMaterialReview(product.sku, id)} />}
  </details> : null;
}
