import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError, api, errorMessage } from '@/shared/api/client';
import { Button, toast } from '@/shared/ui';
import { usePimSlice, useTabContext, type PimProduct } from '@/shared/pim';
import type { StoredBrandProfile } from '@/modules/settings';
import { GpsrEditor, type BrandDefaults } from './GpsrEditor';
import { emptyToySafety, type ProductGpsrData } from '../model/gpsrProfile';

/** Valores vacíos del GPSR de producto (los campos que no vienen de la marca). */
const EMPTY: ProductGpsrData = {
  brand: '', model: '', identifierType: 'ean', identifier: '', toySafety: emptyToySafety(),
  hasImage: false, saleCountries: [], warnings: [], noWarningsNeeded: false, ownLegislationNotice: '',
  sellerDeclaration: false, brandRegistry: 'unknown', amazonCompliance: {},
};

function hasProductImage(product: PimProduct | null): boolean {
  if (!product) return false;
  if (typeof product.image === 'string' && product.image.trim()) return true;
  const images = (product as { images?: unknown }).images;
  return Array.isArray(images) && images.length > 0;
}

function brandDefaultsOf(brand: StoredBrandProfile): BrandDefaults {
  return {
    manufacturerName: brand.manufacturer.name,
    manufacturerEmail: brand.manufacturer.email,
    responsible: brand.euResponsible ? { name: brand.euResponsible.name, email: brand.euResponsible.email } : null,
  };
}
/** Marca completa para heredar: fabricante (nombre+correo) y, si hace falta, responsable. */
function brandIsComplete(brand: StoredBrandProfile): boolean {
  if (!brand.manufacturer.name.trim() || !brand.manufacturer.email.trim()) return false;
  const responsible = brand.euResponsible;
  return responsible === null || (!!responsible.name.trim() && !!responsible.email.trim());
}

/** Fetch directo (sin importar settings en runtime, para no crear un ciclo de módulos).
 * 404 = la marca aún no tiene perfil GPSR → null (no es error; se pedirá completarla). */
const fetchBrand = async (brand: string): Promise<StoredBrandProfile | null> => {
  try {
    return await api.get<{ brand: StoredBrandProfile }>(`/brands/${encodeURIComponent(brand)}`).then(r => r.brand);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};

/**
 * Pestaña «GPSR» de la ficha (GPSR de PRODUCTO, Reglamento UE 2023/988). Cablea el
 * editor rediseñado GpsrEditor al backend: lee/guarda `data.gpsr` vía /api/products
 * (ctx.persist, se versiona en product_revisions), HEREDA fabricante y persona
 * responsable de la MARCA (/api/brands) y refleja la puerta de publicación UE. El
 * guardado es explícito; nada se guarda sin pulsar «Guardar GPSR».
 */
export function GpsrProductTab() {
  const ctx = useTabContext();
  const navigate = useNavigate();
  const product = ctx.isNew ? null : ctx.product;
  const [stored, setStored] = usePimSlice<Partial<ProductGpsrData> | null>('gpsr', null);
  const fromProduct = (product?.gpsr ?? {}) as Partial<ProductGpsrData>;
  const data: ProductGpsrData = {
    ...EMPTY, ...fromProduct, ...(stored ?? {}),
    brand: String(product?.brand ?? stored?.brand ?? fromProduct.brand ?? ''),
    hasImage: hasProductImage(product),
  };
  const brand = data.brand.trim();
  const brandQuery = useQuery({ queryKey: ['gpsr-brand', brand], queryFn: () => fetchBrand(brand), enabled: !!brand, retry: false });
  const brandProfile = brandQuery.data ?? null;
  const brandComplete = !!brandProfile && brandIsComplete(brandProfile);
  const brandDefaults = brandProfile ? brandDefaultsOf(brandProfile) : undefined;

  const save = async () => {
    try {
      const target = (product ?? (typeof ctx.draft === 'function' ? ctx.draft() : {})) as Record<string, unknown>;
      await ctx.persist({ name: String(target.name ?? ''), sku: String(target.sku ?? ''), gpsr: data });
      toast.success('GPSR guardado');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <GpsrEditor data={data} brandComplete={brandComplete} brandDefaults={brandDefaults}
        onChange={next => setStored(next)} onOpenBrand={() => navigate('/espacio/configuracion/gpsr')} />
      <div className="pim-gpsr-save-row">
        <Button variant="primary" icon="shield" onClick={() => void save()}>Guardar GPSR</Button>
      </div>
    </>
  );
}
