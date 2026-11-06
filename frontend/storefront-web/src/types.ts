export type Category = { slug: string; name: string };

export type Product = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  brand_ref?: string;
  category_ref?: string;
  price: number;
  available: number;
};

export type StorefrontCatalog = {
  store: {
    name: string;
    modules?: string[];
    configuration?: { headline?: string };
    branding?: { primaryColor?: string };
  };
  categories: Category[];
  products: Product[];
};

export type CartLine = { product: Product; quantity: number };
export type CustomerProfile = { id: string; name: string; code: string };
export type CustomerAddress = { id: string; label: string; address: string; reference?: string; default: boolean; version: number };
export type CustomerOrder = { id: string; number: string; status: string; currency: string; total: number; created_at: string; delivery: Record<string, unknown>; items: { id: string; name: string; quantity: number; unit_price: number; subtotal: number }[] };
