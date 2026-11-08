import { http } from 'msw';
import { uid } from '@/shared/lib';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { validateBrandProfile, type BrandGpsrProfile, type StoredBrandProfile } from '../model/brandGpsrProfile';
import { readJson } from './helpers';
import { brandsStore } from './store';

/**
 * GPSR por marca (/api/brands), perfil BrandGpsrProfile. El {brand} del path es el
 * NOMBRE de la marca.
 *   GET    /brands          → { brands: StoredBrandProfile[] }
 *   GET    /brands/:brand   → { brand } · 404
 *   PUT    /brands/:brand   BrandGpsrProfile(+revision) → { brand } (upsert) · 400 invalid_brand { fields }
 *   DELETE /brands/:brand   → { ok } · 404
 */
function sameBrand(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'es', { sensitivity: 'base' }) === 0;
}
function find(brand: string): StoredBrandProfile | undefined {
  return brandsStore.all().find(item => sameBrand(item.brand, brand));
}
function clean(body: Partial<BrandGpsrProfile>, fallbackName: string): BrandGpsrProfile {
  return {
    brand: (typeof body.brand === 'string' ? body.brand : fallbackName).trim(),
    manufacturer: (body.manufacturer ?? { name: '', postalAddress: { street: '', postalCode: '', city: '', country: '' }, email: '', pointOfContact: '' }) as BrandGpsrProfile['manufacturer'],
    euResponsible: (body.euResponsible ?? null) as BrandGpsrProfile['euResponsible'],
    autoApply: body.autoApply !== false,
  };
}
function invalid(profile: BrandGpsrProfile) {
  const errors = validateBrandProfile(profile);
  if (!Object.keys(errors).length) return null;
  return HttpResponse.json({ error: 'invalid_brand', message: 'Revisa los datos marcados.', fields: errors }, { status: 400 });
}

export const brandsHandlers = [
  http.get(mock(ENDPOINTS.brands), async () => {
    await latency(300);
    const brands = brandsStore.all().slice().sort((a, b) => a.brand.localeCompare(b.brand, 'es'));
    return HttpResponse.json({ brands });
  }),

  http.get(mock('/brands/:brand'), async ({ params }) => {
    await latency(250);
    const brand = find(decodeURIComponent(String(params.brand)));
    if (!brand) return fail(404, 'Esa marca ya no existe.', 'not_found');
    return HttpResponse.json({ brand });
  }),

  http.put(mock('/brands/:brand'), async ({ params, request }) => {
    await latency(500);
    const name = decodeURIComponent(String(params.brand));
    const body = await readJson<Partial<BrandGpsrProfile>>(request);
    const profile = clean(body, name);
    const error = invalid(profile);
    if (error) return error;
    const current = find(name) ?? (sameBrand(profile.brand, name) ? undefined : find(profile.brand));
    const now = Date.now();
    const stored: StoredBrandProfile = current
      ? { ...profile, id: current.id, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now }
      : { ...profile, id: uid('brand'), revision: 1, createdAt: now, updatedAt: now };
    brandsStore.upsert(stored);
    return HttpResponse.json({ brand: stored });
  }),

  http.delete(mock('/brands/:brand'), async ({ params }) => {
    await latency(400);
    const brand = find(decodeURIComponent(String(params.brand)));
    if (!brand || !brandsStore.remove(brand.id)) return fail(404, 'Esa marca ya no existe.', 'not_found');
    return HttpResponse.json({ ok: true });
  }),
];
